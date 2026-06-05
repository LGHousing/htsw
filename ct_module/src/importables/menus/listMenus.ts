import TaskContext from "../../tasks/context";
import { timedWaitForMenu } from "../../housingSync/gui/menuWait";
import {
    getVisiblePaginatedItemSlots,
    readPaginatedList,
    type PaginatedListConfig,
} from "../../housingSync/gui/paginatedList";
import { removedFormatting } from "../../utils/helpers";

// VERIFY in-game: the empty-list placeholder name and whether menu list slots
// carry a suffix. Mirrors functions/listFunctions.ts.
const MENU_LIST_CONFIG: PaginatedListConfig = {
    label: "menu",
    emptyPlaceholderName: "No Menus!",
};

/**
 * Extract a raw menu name from a `/menus` list slot's display name. Filters the
 * list controls and strips a trailing numeric parenthetical (e.g. "(12 slots)")
 * if present, preserving names that contain other parentheses.
 *
 * VERIFY in-game: the exact suffix format (if any) the `/menus` list shows.
 */
export function extractMenuNameFromSlot(rawDisplayName: string): string | null {
    const trimmed = rawDisplayName.trim();
    if (trimmed.length === 0) return null;
    const lower = trimmed.toLowerCase();
    if (
        lower === "go back" ||
        lower === "close" ||
        lower === "create menu" ||
        lower.indexOf("previous page") >= 0 ||
        lower.indexOf("next page") >= 0
    ) {
        return null;
    }
    const m = trimmed.match(/^(.+?)\s*\(\d[^)]*\)\s*$/);
    return m !== null ? m[1] : trimmed;
}

export async function listAllMenuNames(ctx: TaskContext): Promise<string[]> {
    await ctx.runCommand("/menus");
    await timedWaitForMenu(ctx, "commandMenuWait");

    type Entry = { index: number; name: string };
    const entries = await readPaginatedList<Entry>(
        ctx,
        MENU_LIST_CONFIG,
        async () => {
            const out: Entry[] = [];
            const slots = getVisiblePaginatedItemSlots(ctx);
            for (let i = 0; i < slots.length; i++) {
                const item = slots[i].getItem();
                if (item === null || item === undefined) continue;
                const extracted = extractMenuNameFromSlot(
                    removedFormatting(item.getName())
                );
                if (extracted === null) continue;
                out.push({ index: i, name: extracted });
            }
            return out;
        }
    );

    return entries.map((e) => e.name);
}
