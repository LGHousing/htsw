import type { Action, Importable } from "htsw/types";

import type { ImportableCacheEntry } from "./cache";
import { importableHash, listHashes } from "./hash";
import { importableIdentity, importableKey } from "../importables/identity";
import { readImportableCache } from "./cache";
import { stableStringify } from "../utils/helpers";
import {
    itemDependencyIndexFor,
    type ItemDependencyIndex,
    type ItemDependencySnapshot,
} from "../importables/itemDependencyIndex";

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

// Per-frame front cache over the identity memo below. The memo's validity
// check stringifies the importable's non-action metadata on EVERY call —
// per visible row per frame that stringify (whole NBT trees for items) is
// real main-thread cost under Rhino. Keyed on the wrapper object with a
// short TTL rather than cached forever: edit popovers mutate parsed
// importables IN PLACE (see touchParseCacheMtime), which object identity
// alone would never notice; the TTL bounds that staleness to ~a quarter
// second, after which the meta compare below catches the change.
type FrontHashEntry = { hash: string; at: number };
const frontHashCache = new WeakMap<object, FrontHashEntry>();
const FRONT_HASH_TTL_MS = 250;

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
    const now = Date.now();
    const front = frontHashCache.get(importable);
    if (front !== undefined && now - front.at < FRONT_HASH_TTL_MS) {
        return front.hash;
    }

    const key = importableKey(importable.type, importableIdentity(importable));
    const refs = listRefsOf(importable);
    const meta = metaStringOf(importable);

    const cached = hashCacheByKey.get(key);
    if (cached !== undefined && cached.meta === meta && refsEqual(cached.refs, refs)) {
        frontHashCache.set(importable, { hash: cached.hash, at: now });
        return cached.hash;
    }

    const hash = importableHash(importable);
    hashCacheByKey.set(key, { refs, meta, hash });
    frontHashCache.set(importable, { hash, at: now });
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

// Recompute the entry's hash instead of trusting the stored `entry.hash`:
// a stored hash freezes the hash function's behavior at write time, so any
// later normalization change would mark every old entry "modified" forever.
// Memoized per entry object — `readImportableCache` returns the same object
// until the file is rewritten, at which point the WeakMap entry just drops.
const entryHashCache = new WeakMap<ImportableCacheEntry, string>();
const entryListHashesCache = new WeakMap<
    ImportableCacheEntry,
    Record<string, string[]>
>();

export function cacheEntryHash(entry: ImportableCacheEntry): string {
    let hash = entryHashCache.get(entry);
    if (hash === undefined) {
        hash = importableHash(entry.importable);
        entryHashCache.set(entry, hash);
    }
    return hash;
}

export function cacheEntryListHashes(
    entry: ImportableCacheEntry
): Record<string, string[]> {
    let hashes = entryListHashesCache.get(entry);
    if (hashes === undefined) {
        hashes = listHashes(entry.importable);
        entryListHashesCache.set(entry, hashes);
    }
    return hashes;
}

function validItemDependencySnapshot(
    value: ItemDependencySnapshot | undefined
): ItemDependencySnapshot | null | undefined {
    if (value === undefined) return undefined;
    const candidate = value as unknown as {
        version?: unknown;
        dependencies?: unknown;
    };
    if (candidate.version !== 1 || !Array.isArray(candidate.dependencies)) {
        return null;
    }
    return value;
}

export function sameItemDependencySnapshot(
    left: ItemDependencySnapshot | undefined,
    right: ItemDependencySnapshot | undefined
): boolean {
    const validLeft = validItemDependencySnapshot(left);
    const validRight = validItemDependencySnapshot(right);
    if (validLeft === null || validRight === null) return false;
    const empty: ItemDependencySnapshot = { version: 1, dependencies: [] };
    return stableStringify(validLeft ?? empty) === stableStringify(validRight ?? empty);
}

export function buildCacheStatusRow(
    housingUuid: string,
    importable: Importable,
    itemDependencies?: ItemDependencyIndex
): CacheStatusRow {
    const identity = importableIdentity(importable);
    const hash = memoizedImportableHash(importable);
    const entry = readImportableCache(housingUuid, importable.type, identity);
    const dependencyIndex = itemDependencies ?? itemDependencyIndexFor(importable);
    const dependencySnapshot = dependencyIndex?.snapshotOf(importable);
    const state = entry === null
        ? "unknown"
        : cacheEntryHash(entry) !== hash ||
            (dependencySnapshot !== undefined &&
                !sameItemDependencySnapshot(
                    entry.itemDependencies,
                    dependencySnapshot
                ))
          ? "modified"
          : "current";
    return { importable, identity, hash, state, entry };
}
