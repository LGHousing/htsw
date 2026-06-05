import type { Action, Importable, ImportableEvent } from "htsw/types";

import { applyActionListPlan } from "../../housingSync/actions/applyDiff";
import {
    actionsFullyHydrated,
    prereadActionList,
    type ActionListPlan,
} from "../../housingSync/actions/plan";
import type { ImportableTrustPlan } from "../../importCache";
import type { ImportEventHandler } from "../../housingSync/importEvents";
import { createSetupStepEmitter } from "../../housingSync/progress/setupStepEmitter";
import TaskContext from "../../tasks/context";
import { getActionListTrust, getBaselineActionList } from "../actionListHelpers";
import type { ItemRegistry } from "../itemRegistry";
import {
    countReferencedShells,
    ensureReferencedImportablesExist,
} from "../references";
import { openEventEditor } from "./shared";

export type EventImportPlan = {
    kind: "EVENT";
    importable: ImportableEvent;
    trustPlan?: ImportableTrustPlan;
    actionsPlan: ActionListPlan | null;
};

export async function prereadImportableEvent(
    ctx: TaskContext,
    importable: ImportableEvent,
    itemRegistry: ItemRegistry,
    trustPlan?: ImportableTrustPlan,
    events?: ImportEventHandler
): Promise<EventImportPlan> {
    const setup = createSetupStepEmitter(events, countReferencedShells(importable) + 2);

    await ensureReferencedImportablesExist(ctx, importable, (kind, name) => {
        setup(`created ${kind} ${name}`);
    });

    const actionsTrusted = trustPlan?.trustedListPaths.has("actions") ?? false;
    if (actionsTrusted) {
        return { kind: "EVENT", importable, trustPlan, actionsPlan: null };
    }

    await openEventEditor(ctx, importable.event);
    setup(`opened event actions`);
    setup(`selected ${importable.event}`);

    const actionsPlan = await prereadActionList(ctx, importable.actions, {
        itemRegistry,
        baselineCurrent: getBaselineActionList(trustPlan, "actions"),
        trust: getActionListTrust(trustPlan, "actions"),
        events,
    });
    return { kind: "EVENT", importable, trustPlan, actionsPlan };
}

export async function applyImportableEventPlan(
    ctx: TaskContext,
    plan: EventImportPlan,
    itemRegistry: ItemRegistry,
    events?: ImportEventHandler
): Promise<void> {
    if (plan.actionsPlan === null) return;
    await openEventEditor(ctx, plan.importable.event);
    await applyActionListPlan(ctx, plan.actionsPlan, {
        itemRegistry,
        events,
    });
}

export function eventPlanIsNoOp(plan: EventImportPlan): boolean {
    return plan.actionsPlan === null || plan.actionsPlan.diff.operations.length === 0;
}

export function reconstructPartialEvent(plan: EventImportPlan): Importable | null {
    const live = plan.actionsPlan?.getLiveCurrent?.();
    if (live === undefined || !actionsFullyHydrated(live)) return null;
    return { type: "EVENT", event: plan.importable.event, actions: live as Action[] };
}
