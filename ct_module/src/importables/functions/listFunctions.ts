import TaskContext from "../../tasks/context";
import { isAtMenuTitle } from "../../housingSync/menus/currentMenu";
import {
    findPaginatedListEntry,
    getPaginatedListSlotAtIndex,
    getVisiblePaginatedItemSlots,
    isEmptyPaginatedPlaceholder,
    readPaginatedList,
    type PaginatedListConfig,
} from "../../housingSync/menus/paginatedList";
import type { ItemSlot } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import { snapshotIconStack, type FunctionIconSnapshot } from "./icon";
import { extractFunctionNameFromSlot } from "./housing";
import { functionListOpened } from "../waiters";

const FUNCTION_LIST_CONFIG: PaginatedListConfig = {
    label: "function",
    emptyPlaceholderName: "No items!",
};

// Per-import-session function list, including each entry's last verified index
// and icon. It avoids re-reading /functions for reference checks and lets
// settings navigation move directly between the pages already being visited.
type SessionFunction = {
    index: number | null;
    icon: FunctionIconSnapshot | null;
};

let sessionFunctions: Map<string, SessionFunction> | null = null;

export function resetFunctionNameSession(): void {
    sessionFunctions = null;
}

export function noteFunctionCreated(name: string): void {
    if (sessionFunctions !== null) {
        // A freshly created shell carries the Housing default icon; record it as
        // unknown so an icon-only import treats it as a mismatch and sets the icon.
        sessionFunctions.set(name.toLowerCase(), { index: null, icon: null });
    }
}

async function ensureSessionFunctions(
    ctx: TaskContext
): Promise<Map<string, SessionFunction>> {
    if (sessionFunctions !== null) return sessionFunctions;
    const map = new Map<string, SessionFunction>();
    const entries = await listAllFunctionEntries(ctx);
    for (let i = 0; i < entries.length; i++) {
        map.set(entries[i].name.toLowerCase(), {
            index: entries[i].index,
            icon: entries[i].icon,
        });
    }
    sessionFunctions = map;
    return map;
}

/**
 * The set of existing function names (lowercased) for this import session.
 * Reads the /functions GUI once and caches it; subsequent calls are free.
 */
export async function getSessionFunctionNamesLower(
    ctx: TaskContext
): Promise<Set<string>> {
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
    return (await ensureSessionFunctions(ctx)).get(name.toLowerCase())?.icon ?? null;
}

export async function openFunctionList(ctx: TaskContext): Promise<void> {
    if (isAtMenuTitle(ctx, "Functions")) return;
    await ctx.expectAfter(() => ctx.runCommand("/functions"), functionListOpened());
}

export async function getSessionFunctionListSlot(
    ctx: TaskContext,
    name: string
): Promise<ItemSlot> {
    const functions = await ensureSessionFunctions(ctx);
    await openFunctionList(ctx);

    const key = name.toLowerCase();
    const cached = functions.get(key);
    if (cached !== undefined && cached.index !== null) {
        try {
            const slot = await getPaginatedListSlotAtIndex(
                ctx,
                cached.index,
                cached.index + 1,
                FUNCTION_LIST_CONFIG
            );
            const live = readFunctionEntryFromSlot(slot, cached.index);
            if (live !== null && live.name.toLowerCase() === key) {
                rememberFunctionEntries(functions, [live]);
                return slot;
            }
        } catch (_error) {
            // Fall through to the verified full-list lookup.
        }
    }

    const found = await findPaginatedListEntry(
        ctx,
        FUNCTION_LIST_CONFIG,
        async () => readVisibleFunctionEntries(ctx),
        (entry) => entry.name.toLowerCase() === key,
        (entries) => rememberFunctionEntries(functions, entries)
    );
    if (found === null) {
        throw new Error(`Could not find function "${name}".`);
    }
    rememberFunctionEntries(functions, [found.entry]);
    return found.slot;
}

export type FunctionListEntry = {
    index: number;
    name: string;
    icon: FunctionIconSnapshot | null;
};

export async function listAllFunctionEntries(
    ctx: TaskContext
): Promise<FunctionListEntry[]> {
    await openFunctionList(ctx);

    return readPaginatedList<FunctionListEntry>(ctx, FUNCTION_LIST_CONFIG, async () =>
        readVisibleFunctionEntries(ctx)
    );
}

function readVisibleFunctionEntries(ctx: TaskContext): FunctionListEntry[] {
    const entries: FunctionListEntry[] = [];
    const slots = getVisiblePaginatedItemSlots(ctx);
    for (let i = 0; i < slots.length; i++) {
        if (isEmptyPaginatedPlaceholder(slots[i], FUNCTION_LIST_CONFIG)) continue;
        const entry = readFunctionEntryFromSlot(slots[i], i);
        if (entry !== null) entries.push(entry);
    }
    return entries;
}

function readFunctionEntryFromSlot(
    slot: ItemSlot,
    index: number
): FunctionListEntry | null {
    const item = slot.getItem();
    const name = extractFunctionNameFromSlot(removedFormatting(item.getName()));
    if (name === null) return null;
    return {
        index,
        name,
        icon: snapshotIconStack(item.getItemStack()),
    };
}

function rememberFunctionEntries(
    functions: Map<string, SessionFunction>,
    entries: readonly FunctionListEntry[]
): void {
    for (let i = 0; i < entries.length; i++) {
        functions.set(entries[i].name.toLowerCase(), {
            index: entries[i].index,
            icon: entries[i].icon,
        });
    }
}

export async function listAllFunctionNames(ctx: TaskContext): Promise<string[]> {
    return (await listAllFunctionEntries(ctx)).map((e) => e.name);
}
