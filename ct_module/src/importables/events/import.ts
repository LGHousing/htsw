import type { ImportableEvent } from "htsw/types";

import { syncActionList } from "../../importer/actions/sync";
import { timedWaitForMenu } from "../../importer/gui/menuWait";
import type { ImportableTrustPlan } from "../../importCache";
import type { ImportPreviewEventHandler } from "../../importer/importPreviewEvents";
import TaskContext from "../../tasks/context";
import { getActionListTrust, getBaselineActionList } from "../actionListHelpers";
import type { ItemRegistry } from "../itemRegistry";
import { ensureReferencedImportablesExist } from "../references";

export async function importImportableEvent(
    ctx: TaskContext,
    importable: ImportableEvent,
    itemRegistry: ItemRegistry,
    trustPlan?: ImportableTrustPlan,
    previewHandler?: ImportPreviewEventHandler
): Promise<void> {
    await ensureReferencedImportablesExist(ctx, importable);

    await ctx.runCommand(`/eventactions`);
    await timedWaitForMenu(ctx, "commandMenuWait");

    ctx.getItemSlot(importable.event).click();
    await timedWaitForMenu(ctx, "menuClickWait");

    await syncActionList(ctx, importable.actions, {
        itemRegistry,
        baselineCurrent: getBaselineActionList(trustPlan, "actions"),
        trust: getActionListTrust(trustPlan, "actions"),
        previewHandler,
    });
}
