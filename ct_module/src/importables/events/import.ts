import type { ImportableEvent } from "htsw/types";

import { syncActionList } from "../../importer/actions";
import type { ImportableTrustPlan } from "../../knowledge";
import type { ActionListProgress } from "../../importer/types";
import TaskContext from "../../tasks/context";
import { actionListTrustFor } from "../actionListTrust";
import type { ItemRegistry } from "../itemRegistry";
import { ensureReferencedImportablesExist } from "../references";
import { openEventEditor } from "./shared";

export async function importImportableEvent(
    ctx: TaskContext,
    importable: ImportableEvent,
    itemRegistry: ItemRegistry,
    trustPlan?: ImportableTrustPlan,
    onActionListProgress?: (progress: ActionListProgress) => void
): Promise<void> {
    await ensureReferencedImportablesExist(ctx, importable);

    await openEventEditor(ctx, importable.event);

    await syncActionList(ctx, importable.actions, {
        itemRegistry,
        trust: actionListTrustFor(trustPlan, "actions", importable.actions),
        onProgress: onActionListProgress,
    });
}
