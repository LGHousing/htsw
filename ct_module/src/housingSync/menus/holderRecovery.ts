import type TaskContext from "../../tasks/context";
import { isTaskCancelled } from "../../tasks/manager";
import { removedFormatting } from "../../utils/helpers";
import { clickGoBack, HolderReadError } from "./menuUtils";
import { timedWaitForMenu } from "./menuWait";
import { getPaginatedListSlotAtIndex, type PaginatedListConfig } from "./paginatedList";

type HolderEditor = {
    listTitle: string | null;
    index: number;
    listLength: number;
    displayName: string;
    config: PaginatedListConfig;
    editorTitle: string;
};

const baseTitle = (title: string | null) => (title ?? "").replace(/^\(\d+\/\d+\)\s+/, "");

/** Holder is the first field written. A failed read has not written later fields. */
export async function withHolderRecovery(
    ctx: TaskContext,
    entry: HolderEditor | undefined,
    write: () => Promise<void>
): Promise<void> {
    if (entry === undefined) return write();
    let original: HolderReadError | undefined;
    for (let attempt = 0; ; attempt++) {
        try {
            await write();
            return;
        } catch (error) {
            if (isTaskCancelled(error)) throw error;
            if (!(error instanceof HolderReadError)) throw error;
            original = original ?? error;
            if (attempt === 3) {
                throw new Error(
                    `${original.message}; Holder recovery exhausted after 3 reopens.`
                );
            }
        }
        try {
            if (
                ctx.getOpenContainerTitle() !== entry.editorTitle ||
                entry.listTitle === null
            )
                throw new Error("Holder editor or parent list is no longer known.");
            await clickGoBack(ctx);
            if (baseTitle(ctx.getOpenContainerTitle()) !== baseTitle(entry.listTitle))
                throw new Error("Holder recovery returned to a different list.");
            const slot = await getPaginatedListSlotAtIndex(
                ctx,
                entry.index,
                entry.listLength,
                entry.config
            );
            if (
                baseTitle(ctx.getOpenContainerTitle()) !== baseTitle(entry.listTitle) ||
                removedFormatting(slot.getItem().getName()) !== entry.displayName
            )
                throw new Error("Holder recovery entry no longer matches.");
            slot.click();
            await timedWaitForMenu(ctx, "menuClickWait");
            if (ctx.getOpenContainerTitle() !== entry.editorTitle)
                throw new Error("Holder recovery opened a different editor.");
        } catch (error) {
            if (isTaskCancelled(error)) throw error;
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`${original.message}; ${message}`);
        }
    }
}
