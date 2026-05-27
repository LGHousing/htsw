import type { ImportableEvent } from "htsw/types";

import {
    applyActionListPlan,
    prereadActionList,
    type ActionListPlan,
} from "../../importer/actions/sync";
import { timedWaitForMenu } from "../../importer/gui/menuWait";
import type { ImportableTrustPlan } from "../../importCache";
import type { ImportEventHandler } from "../../importer/importEvents";
import { createSetupStepEmitter } from "../../importer/progress/setupStepEmitter";
import TaskContext from "../../tasks/context";
import { getActionListTrust, getBaselineActionList } from "../actionListHelpers";
import type { ItemRegistry } from "../itemRegistry";
import {
    countReferencedShells,
    ensureReferencedImportablesExist,
} from "../references";

export type EventImportPlan = {
    kind: "EVENT";
    importable: ImportableEvent;
    trustPlan?: ImportableTrustPlan;
    actionsPlan: ActionListPlan | null;
};

async function openEventActions(
    ctx: TaskContext,
    eventName: string
): Promise<void> {
    await ctx.runCommand(`/eventactions`);
    await timedWaitForMenu(ctx, "commandMenuWait");
    ctx.getItemSlot(eventName).click();
    await timedWaitForMenu(ctx, "menuClickWait");
}

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

    await openEventActions(ctx, importable.event);
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
    await openEventActions(ctx, plan.importable.event);
    await applyActionListPlan(ctx, plan.actionsPlan, {
        itemRegistry,
        events,
    });
}
