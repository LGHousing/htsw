import TaskContext from "../../tasks/context";
import type { Pos } from "htsw/types";
import {
    getVisiblePaginatedItemSlots,
    isEmptyPaginatedPlaceholder,
    readPaginatedList,
    type PaginatedListConfig,
} from "../../housingSync/menus/paginatedList";
import { removedFormatting } from "../../utils/helpers";
import { regionListOpened } from "../waiters";

const REGION_LIST_CONFIG: PaginatedListConfig = {
    label: "region",
    emptyPlaceholderName: "No regions!",
};

export type RegionListEntry = {
    index: number;
    name: string;
    bounds: { from: Pos; to: Pos } | null;
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

function parseRegionPos(line: string, label: "From" | "To"): Pos | null {
    const match = line.match(new RegExp(`^${label}:\\s*(-?\\d+),\\s*(-?\\d+),\\s*(-?\\d+)\\s*$`));
    if (match === null) return null;
    return {
        x: Number(match[1]),
        y: Number(match[2]),
        z: Number(match[3]),
    };
}

function parseRegionBounds(lore: string[]): { from: Pos; to: Pos } | null {
    let from: Pos | null = null;
    let to: Pos | null = null;
    for (let i = 0; i < lore.length; i++) {
        const line = removedFormatting(lore[i]).trim();
        from = from ?? parseRegionPos(line, "From");
        to = to ?? parseRegionPos(line, "To");
    }
    return from === null || to === null ? null : { from, to };
}

export async function listAllRegions(ctx: TaskContext): Promise<RegionListEntry[]> {
    await ctx.expectAfter(
        () => ctx.runCommand("/regions"),
        regionListOpened()
    );

    return await readPaginatedList<RegionListEntry>(
        ctx,
        REGION_LIST_CONFIG,
        async () => {
            const out: RegionListEntry[] = [];
            const slots = getVisiblePaginatedItemSlots(ctx);
            for (let i = 0; i < slots.length; i++) {
                if (isEmptyPaginatedPlaceholder(slots[i], REGION_LIST_CONFIG)) continue;
                const item = slots[i].getItem();
                if (item === null || item === undefined) continue;
                const extracted = extractRegionNameFromSlot(
                    removedFormatting(item.getName())
                );
                if (extracted === null) continue;
                out.push({
                    index: i,
                    name: extracted,
                    bounds: parseRegionBounds(item.getLore()),
                });
            }
            return out;
        }
    );
}

export async function listAllRegionNames(ctx: TaskContext): Promise<string[]> {
    const entries = await listAllRegions(ctx);
    return entries.map((e) => e.name);
}
