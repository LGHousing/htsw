import type { Importable } from "htsw/types";

import {
    cacheEntryHashesAreCurrent,
    cacheEntryHash,
    readImportableCache,
    type ImportableCacheEntry,
} from "./cache";
import { listHashes } from "./hash";
import {
    getImportableHashRevision,
    memoizedImportableHash,
    seedImportableHash,
} from "./hashMemo";
import { importableIdentity } from "../importables/identity";
import {
    itemDependencyIndexFor,
    type ItemDependencyIndex,
    sameItemDependencySnapshot,
} from "../importables/items/dependencyIndex";

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

export { getImportableHashRevision, memoizedImportableHash, seedImportableHash };

const entryListHashesCache = new WeakMap<
    ImportableCacheEntry,
    Record<string, string[]>
>();

export function cacheEntryListHashes(
    entry: ImportableCacheEntry
): Record<string, string[]> {
    if (cacheEntryHashesAreCurrent(entry)) return entry.lists;
    let hashes = entryListHashesCache.get(entry);
    if (hashes === undefined) {
        hashes = listHashes(entry.importable);
        entryListHashesCache.set(entry, hashes);
    }
    return hashes;
}

export function buildCacheStatusRow(
    housingUuid: string,
    importable: Importable,
    itemDependencies?: ItemDependencyIndex
): CacheStatusRow {
    const identity = importableIdentity(importable);
    const entry = readImportableCache(housingUuid, importable.type, identity);
    return buildCacheStatusRowFromEntry(importable, entry, itemDependencies);
}

export function buildCacheStatusRowFromEntry(
    importable: Importable,
    entry: ImportableCacheEntry | null,
    itemDependencies?: ItemDependencyIndex
): CacheStatusRow {
    const identity = importableIdentity(importable);
    const hash = memoizedImportableHash(importable);
    const dependencyIndex = itemDependencies ?? itemDependencyIndexFor(importable);
    const dependencySnapshot = dependencyIndex?.snapshotOf(importable);
    const state =
        entry === null
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
