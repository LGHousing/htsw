import TaskContext from "../../tasks/context";
import { timedWaitForMenu } from "../../importer/gui/menuWait";
import {
    getVisiblePaginatedItemSlots,
    readPaginatedList,
    type PaginatedListConfig,
} from "../../importer/gui/paginatedList";
import { removedFormatting } from "../../utils/helpers";
import { snapshotIconStack, type FunctionIconSnapshot } from "./icon";
import { extractFunctionNameFromSlot } from "./shared";

const FUNCTION_LIST_CONFIG: PaginatedListConfig = {
    label: "function",
    emptyPlaceholderName: "No Functions!",
};

// Per-import-session cache of the house's functions (lowercased name → current
// icon snapshot), so the reference-preflight doesn't re-read the whole
// /functions GUI once per imported function. The icon rides along for free —
// each list slot IS the function's icon — letting an icon-only import confirm a
// match without opening any settings menu. Populated on first need, kept in
// sync as we create shells, reset at the start of each import session.
let sessionFunctions: Map<string, FunctionIconSnapshot | null> | null = null;

export function resetFunctionNameSession(): void {
    sessionFunctions = null;
}

export function noteFunctionCreated(name: string): void {
    if (sessionFunctions !== null) {
        // A freshly created shell carries the Housing default icon; record it as
        // unknown so an icon-only import treats it as a mismatch and sets the icon.
        sessionFunctions.set(name.toLowerCase(), null);
    }
}

async function ensureSessionFunctions(
    ctx: TaskContext
): Promise<Map<string, FunctionIconSnapshot | null>> {
    if (sessionFunctions !== null) return sessionFunctions;
    const map = new Map<string, FunctionIconSnapshot | null>();
    const entries = await listAllFunctionEntries(ctx);
    for (let i = 0; i < entries.length; i++) {
        map.set(entries[i].name.toLowerCase(), entries[i].icon);
    }
    sessionFunctions = map;
    return map;
}

/**
 * The set of existing function names (lowercased) for this import session.
 * Reads the /functions GUI once and caches it; subsequent calls are free.
 */
export async function getSessionFunctionNamesLower(ctx: TaskContext): Promise<Set<string>> {
    return new Set((await ensureSessionFunctions(ctx)).keys());
}

/**
 * Current icon of a function as shown in the /functions list (item + count),
 * or null when the function doesn't exist or was created this session. Free
 * after the first call — it reuses the same cached read as name existence.
 */
export async function getSessionFunctionIcon(
    ctx: TaskContext,
    name: string
): Promise<FunctionIconSnapshot | null> {
    return (await ensureSessionFunctions(ctx)).get(name.toLowerCase()) ?? null;
}

type FunctionListEntry = { name: string; icon: FunctionIconSnapshot | null };

async function listAllFunctionEntries(ctx: TaskContext): Promise<FunctionListEntry[]> {
    await ctx.runCommand("/functions");
    await timedWaitForMenu(ctx, "commandMenuWait");

    type Entry = { index: number; name: string; icon: FunctionIconSnapshot | null };
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
                out.push({
                    index: i,
                    name: extracted,
                    icon: snapshotIconStack(item.getItemStack()),
                });
            }
            return out;
        },
    );

    return entries.map((e) => ({ name: e.name, icon: e.icon }));
}

export async function listAllFunctionNames(ctx: TaskContext): Promise<string[]> {
    return (await listAllFunctionEntries(ctx)).map((e) => e.name);
}
