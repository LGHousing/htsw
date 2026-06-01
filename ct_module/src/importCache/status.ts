import type { Action, Importable } from "htsw/types";

import type { ImportableCacheEntry } from "./cache";
import { importableHash } from "./hash";
import { importableIdentity, importableKey } from "./paths";
import { readImportableCache } from "./cache";
import { stableStringify } from "../utils/helpers";

export type CacheState = "current" | "modified" | "unknown";

export type CacheStatusRow = {
    importable: Importable;
    identity: string;
    hash: string;
    state: CacheState;
    entry: ImportableCacheEntry | null;
};

export function sameHashList(
    left: readonly string[] | undefined,
    right: readonly string[] | undefined
): boolean {
    if (left === undefined || right === undefined) return false;
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return false;
    }
    return true;
}

// importableHash depends only on the importable's content, not the house. A
// reparse produces fresh wrapper objects (so a WeakMap keyed on the importable
// would miss every time), but the htsl per-file cache hands back the SAME
// Action[] reference for unchanged files. So we key on the stable importable
// identity and validate the cached hash two ways: the top-level action-list
// references are still `===` (same file content, nested lists included) AND the
// non-list metadata stringifies the same. Any edit changes a ref or the meta and
// forces a recompute of the identical hash.
const ACTION_LIST_KEYS: ReadonlyArray<string> = [
    "actions",
    "onEnterActions",
    "onExitActions",
    "leftClickActions",
    "rightClickActions",
];

type HashCacheEntry = {
    refs: ReadonlyArray<readonly Action[]>;
    meta: string;
    hash: string;
};

const hashCacheByKey = new Map<string, HashCacheEntry>();

function listRefsOf(importable: Importable): ReadonlyArray<readonly Action[]> {
    const record = importable as unknown as Record<string, unknown>;
    const refs: Array<readonly Action[]> = [];
    for (let i = 0; i < ACTION_LIST_KEYS.length; i++) {
        const value = record[ACTION_LIST_KEYS[i]];
        if (Array.isArray(value)) refs.push(value as readonly Action[]);
    }
    return refs;
}

function metaStringOf(importable: Importable): string {
    const record = importable as unknown as Record<string, unknown>;
    const rest: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
        if (
            key === "actions" ||
            key === "onEnterActions" ||
            key === "onExitActions" ||
            key === "leftClickActions" ||
            key === "rightClickActions"
        ) {
            continue;
        }
        rest[key] = record[key];
    }
    return stableStringify(rest);
}

function refsEqual(
    left: ReadonlyArray<readonly Action[]>,
    right: ReadonlyArray<readonly Action[]>
): boolean {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
        if (left[i] !== right[i]) return false;
    }
    return true;
}

export function memoizedImportableHash(importable: Importable): string {
    const key = importableKey(importable.type, importableIdentity(importable));
    const refs = listRefsOf(importable);
    const meta = metaStringOf(importable);

    const cached = hashCacheByKey.get(key);
    if (cached !== undefined && cached.meta === meta && refsEqual(cached.refs, refs)) {
        return cached.hash;
    }

    const hash = importableHash(importable);
    hashCacheByKey.set(key, { refs, meta, hash });
    return hash;
}

/** Pre-seed the hash for an importable so the next build skips recomputing it.
 * Used by the parse-snapshot loader to reuse hashes computed in a prior session. */
export function seedImportableHash(importable: Importable, hash: string): void {
    const key = importableKey(importable.type, importableIdentity(importable));
    hashCacheByKey.set(key, {
        refs: listRefsOf(importable),
        meta: metaStringOf(importable),
        hash,
    });
}

export function buildCacheStatusRow(
    housingUuid: string,
    importable: Importable
): CacheStatusRow {
    const identity = importableIdentity(importable);
    const hash = memoizedImportableHash(importable);
    const entry = readImportableCache(housingUuid, importable.type, identity);
    const state =
        entry === null ? "unknown" : entry.hash === hash ? "current" : "modified";
    return { importable, identity, hash, state, entry };
}

export function buildCacheStatusRows(
    housingUuid: string,
    importables: readonly Importable[]
): CacheStatusRow[] {
    const rows: CacheStatusRow[] = [];
    for (let i = 0; i < importables.length; i++) {
        rows.push(buildCacheStatusRow(housingUuid, importables[i]));
    }
    return rows;
}
