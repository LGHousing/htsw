import TaskContext from "../../tasks/context";
import { timedWaitForMenu } from "../../housingSync/gui/menuWait";
import {
    getVisiblePaginatedItemSlots,
    isEmptyPaginatedPlaceholder,
    readPaginatedList,
    type PaginatedListConfig,
} from "../../housingSync/gui/paginatedList";
import { removedFormatting } from "../../utils/helpers";

const REGION_LIST_CONFIG: PaginatedListConfig = {
    label: "region",
    emptyPlaceholderName: "No regions!",
};

/**
 * Extract a raw region name from a `/regions` list slot's display name. Filters
 * the list controls and strips a trailing numeric parenthetical if present,
 * preserving names that contain other parentheses.
 */
function extractRegionNameFromSlot(rawDisplayName: string): string | null {
    const trimmed = rawDisplayName.trim();
    if (trimmed.length === 0) return null;
    const lower = trimmed.toLowerCase();
    if (
        lower === "go back" ||
        lower === "close" ||
        lower === "create region" ||
        lower.indexOf("previous page") >= 0 ||
        lower.indexOf("next page") >= 0
    ) {
        return null;
    }
    const m = trimmed.match(/^(.+?)\s*\(\d[^)]*\)\s*$/);
    return m !== null ? m[1] : trimmed;
}

export async function listAllRegionNames(ctx: TaskContext): Promise<string[]> {
    await ctx.runCommand("/regions");
    await timedWaitForMenu(ctx, "commandMenuWait");

    type Entry = { index: number; name: string };
    const entries = await readPaginatedList<Entry>(
        ctx,
        REGION_LIST_CONFIG,
        async () => {
            const out: Entry[] = [];
            const slots = getVisiblePaginatedItemSlots(ctx);
            for (let i = 0; i < slots.length; i++) {
                if (isEmptyPaginatedPlaceholder(slots[i], REGION_LIST_CONFIG)) continue;
                const item = slots[i].getItem();
                if (item === null || item === undefined) continue;
                const extracted = extractRegionNameFromSlot(
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
