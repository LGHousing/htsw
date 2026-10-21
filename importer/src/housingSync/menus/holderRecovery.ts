import type TaskContext from "../../tasks/context";
import { isTaskCancelled } from "../../tasks/manager";
import { errorMessage, removedFormatting } from "../../utils/helpers";
import { clickGoBack, HolderReadError } from "./menuUtils";
import { timedWaitForMenu } from "./menuWait";
import { ACTION_MAPPINGS } from "../fields/actionMappings";
import {
    getPaginatedListSlotAtIndex,
    getVisiblePaginatedItemSlots,
    isEmptyPaginatedPlaceholder,
    readPaginatedList,
    type PaginatedListConfig,
} from "./paginatedList";

type HolderEditor = {
    listTitle: string | null;
    index: number;
    listLength: number;
    displayName: string;
    config: PaginatedListConfig;
    editorTitle: string;
    reopenList?: () => Promise<void>;
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
            for (let refresh = 0; ; refresh++) {
                if (baseTitle(ctx.getOpenContainerTitle()) !== baseTitle(entry.listTitle))
                    throw new Error(
                        `Holder recovery returned to "${ctx.getOpenContainerTitle() ?? "(closed)"}"; expected "${entry.listTitle}".`
                    );
                const entries = await readPaginatedList(ctx, entry.config, async () =>
                    getVisiblePaginatedItemSlots(ctx)
                        .filter(
                            (slot) => !isEmptyPaginatedPlaceholder(slot, entry.config)
                        )
                        .map((_slot, index) => ({ index }))
                );
                if (entries.length !== entry.listLength) {
                    throw new Error(
                        `Holder recovery list "${ctx.getOpenContainerTitle() ?? "(closed)"}" length changed: expected ${entry.listLength}, found ${entries.length} (index ${entry.index}).`
                    );
                }
                const slot = await getPaginatedListSlotAtIndex(
                    ctx,
                    entry.index,
                    entry.config
                );
                const name = removedFormatting(slot.getItem().getName());
                if (baseTitle(ctx.getOpenContainerTitle()) !== baseTitle(entry.listTitle))
                    throw new Error(
                        `Holder recovery reached "${ctx.getOpenContainerTitle() ?? "(closed)"}"; expected "${entry.listTitle}".`
                    );
                if (name === entry.displayName) {
                    slot.click();
                    break;
                }
                // A malformed render can contain an action icon even in a
                // condition list. Refresh through the owner; never click it.
                if (
                    (name === "Head" ||
                        name.trim() === "" ||
                        Object.values(ACTION_MAPPINGS).some(
                            (action) => action.displayName === name
                        )) &&
                    entry.reopenList !== undefined &&
                    refresh < 2
                ) {
                    await entry.reopenList();
                    continue;
                }
                throw new Error(
                    `Holder recovery entry no longer matches: "${ctx.getOpenContainerTitle() ?? "(closed)"}" held "${name}" at index ${entry.index} (length ${entry.listLength}); expected "${entry.displayName}" after ${refresh} parent list reopens.`
                );
            }
            await timedWaitForMenu(ctx, "menuClickWait");
            if (ctx.getOpenContainerTitle() !== entry.editorTitle)
                throw new Error("Holder recovery opened a different editor.");
        } catch (error) {
            if (isTaskCancelled(error)) throw error;
            const message = errorMessage(error);
            throw new Error(`${original.message}; ${message}`);
        }
    }
}
