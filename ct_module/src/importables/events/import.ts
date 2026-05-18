import type { ImportableEvent } from "htsw/types";

import { syncActionList } from "../../importer/actions/sync";
import { timedWaitForMenu } from "../../importer/gui/helpers";
import type { ImportableTrustPlan } from "../../knowledge";
import type { ActionListProgressFields } from "../../importer/progress/types";
import TaskContext from "../../tasks/context";
import { actionListTrustFor } from "../actionListTrust";
import type { ItemRegistry } from "../itemRegistry";
import { ensureReferencedImportablesExist } from "../references";

export async function importImportableEvent(
    ctx: TaskContext,
    importable: ImportableEvent,
    itemRegistry: ItemRegistry,
    trustPlan?: ImportableTrustPlan,
    onActionListProgress?: (progress: ActionListProgressFields) => void
): Promise<void> {
    await ensureReferencedImportablesExist(ctx, importable);

    await ctx.runCommand(`/eventactions`);
    await timedWaitForMenu(ctx, "commandMenuWait");

    ctx.getItemSlot(importable.event).click();
    await timedWaitForMenu(ctx, "menuClickWait");

    await syncActionList(ctx, importable.actions, {
        itemRegistry,
        trust: actionListTrustFor(trustPlan, "actions", importable.actions),
        onProgress: onActionListProgress,
    });
}
