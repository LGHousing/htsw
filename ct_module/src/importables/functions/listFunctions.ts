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
import { extractFunctionNameFromSlot, openFunctionEditor } from "./housing";
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

export type FunctionListIndexHint = { name: string; index: number };

// Hints are navigation only: neither presence, absence nor icons are trusted.
// The host supplies them just before ONE import, scoped to its destination.
let pendingIndexHints: { housingUuid: string; entries: FunctionListIndexHint[] } | null = null;
let indexHints: Map<string, SessionFunction> | null = null;

/** Opt in for the next import only. Pass null to discard pending/active hints.
 * Indices are zero-based across the 21-entry Functions pages. The caller must
 * discard its index on house transfer or any create/delete/rename. Stale hints
 * are safe: requested names are probed live, and every list slot is verified.
 */
export function setFunctionListIndexHints(
    housingUuid: string,
    entries: readonly FunctionListIndexHint[] | null
): void {
    pendingIndexHints = null;
    indexHints = null;
    if (entries === null) return;
    if (!housingUuid) throw new Error("Function index hints need a house UUID.");
    const names = new Set<string>();
    const indices = new Set<number>();
    const copy: FunctionListIndexHint[] = [];
    for (const entry of entries) {
        const key = entry.name.toLowerCase();
        if (!key || entry.name !== entry.name.trim() ||
            !Number.isInteger(entry.index) || entry.index < 0 || entry.index > 9007199254740991 ||
            names.has(key) || indices.has(entry.index)) {
            throw new Error("Invalid or duplicate function index hint.");
        }
        names.add(key);
        indices.add(entry.index);
        copy.push({ name: entry.name, index: entry.index });
    }
    pendingIndexHints = { housingUuid: housingUuid.toLowerCase(), entries: copy };
}

export function resetFunctionNameSession(housingUuid?: string): void {
    sessionFunctions = null;
    const pending = pendingIndexHints;
    pendingIndexHints = null;
    indexHints = null;
    if (pending !== null && pending.housingUuid === housingUuid?.toLowerCase()) {
        indexHints = new Map<string, SessionFunction>();
        for (const entry of pending.entries) {
            indexHints.set(entry.name.toLowerCase(), { index: entry.index, icon: null });
        }
    }
}

/** Drop every position on create/delete/rename, including ambiguous renames.
 * Keep live name probing enabled for the rest of this opted-in import.
 */
export function invalidateFunctionListIndexHints(): void {
    pendingIndexHints = null;
    indexHints?.clear();
}

export function noteFunctionCreated(name: string): void {
    invalidateFunctionListIndexHints();
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
 * With explicit index hints, requestedNames instead probes each requested name
 * live. Omit requestedNames when complete enumeration is required.
 */
export async function getSessionFunctionNamesLower(
    ctx: TaskContext,
    requestedNames?: readonly string[]
): Promise<Set<string>> {
    if (indexHints !== null && requestedNames !== undefined) {
        const existing = new Set<string>();
        for (const name of requestedNames) {
            const key = name.toLowerCase();
            if (existing.has(key)) continue;
            if (await openFunctionEditor(ctx, name) === "opened") existing.add(key);
            else invalidateFunctionListIndexHints();
        }
        return existing;
    }
    // Enumeration callers still get a complete live scan, even when opted in.
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
    if (indexHints !== null) {
        const slot = await getSessionFunctionListSlot(ctx, name);
        return snapshotIconStack(slot.getItem().getItemStack());
    }
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
    const functions = indexHints ?? await ensureSessionFunctions(ctx);
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
        // One stale position means the ordering may have changed everywhere.
        if (indexHints !== null) functions.clear();
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
