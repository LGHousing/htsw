import TaskContext from "../../tasks/context";
import { timedWaitForMenu } from "../../importer/gui/menuWait";
import {
    getVisiblePaginatedItemSlots,
    readPaginatedList,
    type PaginatedListConfig,
} from "../../importer/gui/paginatedList";
import { removedFormatting } from "../../utils/helpers";
import { extractFunctionNameFromSlot } from "./shared";

const FUNCTION_LIST_CONFIG: PaginatedListConfig = {
    label: "function",
    emptyPlaceholderName: "No Functions!",
};

// Per-import-session cache of the house's function names (lowercased), so the
// reference-preflight doesn't re-read the whole /functions GUI once per
// imported function. Populated on first need, kept in sync as we create shells,
// and reset at the start of each import session.
let sessionFunctionNamesLower: Set<string> | null = null;

export function resetFunctionNameSession(): void {
    sessionFunctionNamesLower = null;
}

export function noteFunctionCreated(name: string): void {
    if (sessionFunctionNamesLower !== null) {
        sessionFunctionNamesLower.add(name.toLowerCase());
    }
}

/**
 * The set of existing function names (lowercased) for this import session.
 * Reads the /functions GUI once and caches it; subsequent calls are free.
 */
export async function getSessionFunctionNamesLower(ctx: TaskContext): Promise<Set<string>> {
    if (sessionFunctionNamesLower !== null) return sessionFunctionNamesLower;
    const names = await listAllFunctionNames(ctx);
    const set = new Set<string>();
    for (let i = 0; i < names.length; i++) set.add(names[i].toLowerCase());
    sessionFunctionNamesLower = set;
    return set;
}

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
