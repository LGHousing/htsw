import type { Action, Importable, ImportableEvent } from "htsw/types";

import {
    applyActionListPlan,
    type ActionListApplyResult,
} from "../../housingSync/actions/apply";
import {
    actionsFullyHydrated,
    type ActionListPlan,
} from "../../housingSync/actions/plan";
import { prepareActionListSync } from "../../housingSync/actions/prepareSync";
import type { ImportableTrustPlan } from "../../importCache";
import { createSetupStepEmitter } from "../../housingSync/syncEvents";
import TaskContext from "../../tasks/context";
import type { ImportSession } from "../imports";
import {
    countReferencedShells,
    createMissingReferencedShells,
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
    session: ImportSession,
    trustPlan?: ImportableTrustPlan
): Promise<EventImportPlan> {
    const setup = createSetupStepEmitter(
        session.events,
        countReferencedShells(importable) + 2
    );

    await createMissingReferencedShells(ctx, importable, (kind, name) => {
        setup(`created ${kind} ${name}`);
    });

    const actionsSync = await prepareActionListSync(ctx, {
        desired: importable.actions,
        session,
        trustPlan,
        basePath: "actions",
        open: async () => {
            await openEventEditor(ctx, importable.event);
            setup(`opened event actions`);
            setup(`selected ${importable.event}`);
        },
    });
    if (actionsSync.kind === "skipped") {
        return { kind: "EVENT", importable, trustPlan, actionsPlan: null };
    }

    return { kind: "EVENT", importable, trustPlan, actionsPlan: actionsSync.plan };
}

export async function applyImportableEventPlan(
    ctx: TaskContext,
    plan: EventImportPlan,
    session: ImportSession
): Promise<void> {
    if (plan.actionsPlan === null) return;
    await openEventEditor(ctx, plan.importable.event);
    await applyActionListPlan(ctx, plan.actionsPlan, {
        session,
    });
}

export function eventPlanIsNoOp(plan: EventImportPlan): boolean {
    return plan.actionsPlan === null || plan.actionsPlan.diff.operations.length === 0;
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
