import type { ImportableEvent } from "htsw/types";

import { syncActionList } from "../../importer/actions";
import { waitForMenu } from "../../importer/helpers";
import type { ImportableTrustPlan } from "../../knowledge";
import TaskContext from "../../tasks/context";
import { actionListTrustFor } from "../actionListTrust";
import type { ItemRegistry } from "../itemRegistry";
import { ensureReferencedImportablesExist } from "../references";

export async function importImportableEvent(
    ctx: TaskContext,
    importable: ImportableEvent,
    itemRegistry: ItemRegistry,
    trustPlan?: ImportableTrustPlan
): Promise<void> {
    await ensureReferencedImportablesExist(ctx, importable);

    ctx.runCommand(`/eventactions`);
    await waitForMenu(ctx);

    ctx.getItemSlot(importable.event).click();
    await waitForMenu(ctx);

    await syncActionList(ctx, importable.actions, {
        itemRegistry,
        trust: actionListTrustFor(trustPlan, "actions", importable.actions),
    });
}
