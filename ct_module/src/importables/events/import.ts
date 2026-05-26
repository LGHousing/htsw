import type { ImportableEvent } from "htsw/types";

import { syncActionList } from "../../importer/actions/sync";
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

export async function importImportableEvent(
    ctx: TaskContext,
    importable: ImportableEvent,
    itemRegistry: ItemRegistry,
    trustPlan?: ImportableTrustPlan,
    events?: ImportEventHandler
): Promise<void> {
    const setup = createSetupStepEmitter(events, countReferencedShells(importable) + 2);

    await ensureReferencedImportablesExist(ctx, importable, (kind, name) => {
        setup(`created ${kind} ${name}`);
    });

    await ctx.runCommand(`/eventactions`);
    await timedWaitForMenu(ctx, "commandMenuWait");
    setup(`opened event actions`);

    ctx.getItemSlot(importable.event).click();
    await timedWaitForMenu(ctx, "menuClickWait");
    setup(`selected ${importable.event}`);

    await syncActionList(ctx, importable.actions, {
        itemRegistry,
        baselineCurrent: getBaselineActionList(trustPlan, "actions"),
        trust: getActionListTrust(trustPlan, "actions"),
        events,
    });
}
