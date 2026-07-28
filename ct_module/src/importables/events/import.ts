import type { Action, Importable, ImportableEvent } from "htsw/types";

import {
    applyActionListPlan,
    type ActionListApplyResult,
} from "../../housingSync/actions/apply";
import {
    actionListPlanNeedsApply,
    type ActionListPlan,
} from "../../housingSync/actions/plan";
import {
    actionsFullyHydrated,
    fullyHydratedActionsFromSlots,
} from "../../housingSync/actions/hydration/plan";
import {
    actionListPlanFromRead,
    hydrateActionListSync,
    scanActionListSync,
    type ActionListSyncScanResult,
} from "../../housingSync/actions/prepareSync";
import type { ImportableTrustPlan } from "../../importCache";
import { createSetupStepEmitter } from "../../housingSync/syncEvents";
import TaskContext from "../../tasks/context";
import type { ImportContext } from "../import/context";
import { importableIdentity } from "../identity";
import { openEventEditor } from "./housing";
import { COST } from "../../housingSync/progress/costs";
import {
    actionListStep,
    defineApplicationPlan,
    workStep,
    type ApplicationPlan,
    type ApplicationProgress,
} from "../import/applicationProgress";

export type EventImportPlan = {
    kind: "EVENT";
    importable: ImportableEvent;
    trustPlan?: ImportableTrustPlan;
    actionsPlan: ActionListPlan | null;
};

export type EventRead = {
    kind: "EVENT";
    importable: ImportableEvent;
    trustPlan?: ImportableTrustPlan;
    actions: ActionListSyncScanResult;
};

export async function scanImportableEvent(
    ctx: TaskContext,
    importable: ImportableEvent,
    session: ImportContext,
    trustPlan?: ImportableTrustPlan
): Promise<EventRead> {
    const setup = createSetupStepEmitter(session.actions.events, 2);
    const actions = await scanActionListSync(ctx, {
        desired: importable.actions,
        sync: session.actions,
        trustPlan,
        basePath: "actions",
        conflictTarget: {
            type: importable.type,
            identity: importableIdentity(importable),
            basePath: "actions",
        },
        open: async () => {
            await openEventEditor(ctx, importable.event);
            setup(`opened event actions`);
            setup(`selected ${importable.event}`);
        },
    });
    return { kind: "EVENT", importable, trustPlan, actions };
}

export async function hydrateImportableEvent(
    ctx: TaskContext,
    read: EventRead
): Promise<void> {
    if (read.actions.kind !== "hydrate") return;
    read.actions = await hydrateActionListSync(ctx, read.actions);
}

export function planImportableEvent(read: EventRead): EventImportPlan {
    return {
        kind: "EVENT",
        importable: read.importable,
        trustPlan: read.trustPlan,
        actionsPlan: actionListPlanFromRead(read.actions),
    };
}

export async function applyImportableEventPlan(
    ctx: TaskContext,
    plan: EventImportPlan,
    session: ImportContext,
    application: ApplicationProgress
): Promise<void> {
    const actionsPlan = plan.actionsPlan;
    if (!actionListPlanNeedsApply(actionsPlan)) return;
    await application.run("openActions", () =>
        openEventEditor(ctx, plan.importable.event)
    );
    await application.runActionList("actions", actionsPlan, session.actions, (sync) =>
        applyActionListPlan(ctx, actionsPlan, { sync })
    );
}

export function eventPlanIsNoOp(plan: EventImportPlan): boolean {
    return !actionListPlanNeedsApply(plan.actionsPlan);
}

export function eventApplicationPlan(plan: EventImportPlan): ApplicationPlan {
    const actionsPlan = plan.actionsPlan;
    if (!actionListPlanNeedsApply(actionsPlan)) {
        return defineApplicationPlan([workStep("cache", COST.cacheWrite)]);
    }
    return defineApplicationPlan([
        workStep(
            "openActions",
            COST.commandInterval + COST.commandMenuWait + COST.menuClickWait
        ),
        actionListStep("actions", actionsPlan),
        workStep("cache", COST.cacheWrite),
    ]);
}

export function reconstructObservedEvent(plan: EventImportPlan): Importable | null {
    if (plan.actionsPlan === null) return null;
    const actions = fullyHydratedActionsFromSlots(plan.actionsPlan.observed);
    if (actions === null) return null;
    return { type: "EVENT", event: plan.importable.event, actions };
}

export function reconstructPartialEvent(
    plan: EventImportPlan,
    result: ActionListApplyResult | null
): Importable | null {
    const current = result?.currentSnapshot;
    if (current === undefined || !actionsFullyHydrated(current)) return null;
    return {
        type: "EVENT",
        event: plan.importable.event,
        actions: current.slice() as Action[],
    };
}
