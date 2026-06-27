import type { Action, Importable, ImportableEvent } from "htsw/types";

import { applyActionListPlan } from "../../housingSync/actions/applyDiff";
import {
    actionsFullyHydrated,
    type ActionListPlan,
} from "../../housingSync/actions/plan";
import type { ImportableTrustPlan } from "../../importCache";
import { createSetupStepEmitter } from "../../housingSync/progress/setupStepEmitter";
import TaskContext from "../../tasks/context";
import {
    hasTrustedActionListBaseline,
    prereadActionListUsingTrust,
} from "../actionListHelpers";
import type { ImportSession } from "../imports";
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
    session: ImportSession,
    trustPlan?: ImportableTrustPlan
): Promise<EventImportPlan> {
    const trustedBaseline = hasTrustedActionListBaseline(trustPlan, "actions");
    const setup = createSetupStepEmitter(
        session.events,
        countReferencedShells(importable) + (trustedBaseline ? 1 : 2)
    );

    await ensureReferencedImportablesExist(ctx, importable, (kind, name) => {
        setup(`created ${kind} ${name}`);
    });

    const actionsTrusted = trustPlan?.trustedListPaths.has("actions") ?? false;
    if (actionsTrusted) {
        return { kind: "EVENT", importable, trustPlan, actionsPlan: null };
    }

    if (trustedBaseline) {
        setup(`planned ${importable.event} from cache`);
        const actionsPlan = await prereadActionListUsingTrust(ctx, importable.actions, {
            session,
            trustPlan,
            basePath: "actions",
        });
        return { kind: "EVENT", importable, trustPlan, actionsPlan };
    }

    await openEventEditor(ctx, importable.event);
    setup(`opened event actions`);
    setup(`selected ${importable.event}`);

    const actionsPlan = await prereadActionListUsingTrust(ctx, importable.actions, {
        session,
        trustPlan,
        basePath: "actions",
    });
    return { kind: "EVENT", importable, trustPlan, actionsPlan };
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

export function reconstructPartialEvent(plan: EventImportPlan): Importable | null {
    const live = plan.actionsPlan?.getLiveCurrent?.();
    if (live === undefined || !actionsFullyHydrated(live)) return null;
    return { type: "EVENT", event: plan.importable.event, actions: live as Action[] };
}
