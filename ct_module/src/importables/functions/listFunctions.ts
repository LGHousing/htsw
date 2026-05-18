import TaskContext from "../../tasks/context";
import { timedWaitForMenu } from "../../importer/helpers";
import {
    getVisiblePaginatedItemSlots,
    readPaginatedList,
    type PaginatedListConfig,
} from "../../importer/paginatedList";
import { removedFormatting } from "../../utils/helpers";
import { extractFunctionNameFromSlot } from "./shared";

const FUNCTION_LIST_CONFIG: PaginatedListConfig = {
    label: "function",
    // Verified empirically: Hypixel shows "No Functions!" in an empty
    // housing's function list, matching the `No Actions!` / `No
    // Conditions!` placeholder convention. If Hypixel ever changes
    // this, an empty-list export would silently skip the placeholder
    // slot — harmless because `readPaginatedList` won't return any
    // entries from a single-placeholder page.
    emptyPlaceholderName: "No Functions!",
};

/**
 * Walk the housing's paginated function list and return every function
 * name in menu order. Opens `/functions`, reads each page, and resets
 * to page 1 when finished. Caller is responsible for closing the menu.
 *
 * Names returned are the bare form (usable directly with
 * `/function edit`) — Hypixel's `(#NNNN)` id suffix is stripped via
 * `extractFunctionNameFromSlot`.
 */
export async function listAllFunctionNames(ctx: TaskContext): Promise<string[]> {
    await ctx.runCommand("/functions");
    await timedWaitForMenu(ctx, "commandMenuWait");

    type Entry = { index: number; name: string };
    const entries = await readPaginatedList<Entry>(
        ctx,
        FUNCTION_LIST_CONFIG,
        async () => {
            const out: Entry[] = [];
            const slots = getVisiblePaginatedItemSlots(ctx);
            for (let i = 0; i < slots.length; i++) {
                const item = slots[i].getItem();
                if (item === null || item === undefined) continue;
                const extracted = extractFunctionNameFromSlot(
                    removedFormatting(item.getName()),
                );
                if (extracted === null) continue;
                out.push({ index: i, name: extracted });
            }
            return out;
        },
    );

    return entries.map((e) => e.name);
}
