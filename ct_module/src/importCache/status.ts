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

/**
 * Index of the knowledge row for `(identity, type)`, or -1. Knowledge rows are
 * uniquely keyed by this pair (identity alone collides across types), so every
 * row lookup/upsert resolves through here.
 */
export function findCacheRowIndex(
    rows: readonly CacheStatusRow[],
    identity: string,
    type: Importable["type"]
): number {
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].identity === identity && rows[i].importable.type === type) return i;
    }
    return -1;
}

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

// A full importableHash is expensive, so we memoize it. A reparse builds new
// importable wrapper objects every time, so a WeakMap keyed on the importable
// itself would never hit; but parsing reuses the SAME Action[] arrays for
// files that didn't change. So we key the memo on the stable importable
// identity and treat the cached hash as valid only when both still hold: the
// action-list arrays are the same references (=== , so unchanged file content,
// nested lists included) AND the non-action metadata stringifies identically.
// Any edit changes an array reference or the metadata, forcing a recompute.
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
