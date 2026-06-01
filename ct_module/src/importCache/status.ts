import type { Importable } from "htsw/types";

import type { ImportableCacheEntry } from "./cache";
import { importableHash, getHashBreakdown, resetHashBreakdown } from "./hash";
import { importableIdentity } from "./paths";
import { readImportableCache } from "./cache";

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

// importableHash depends only on the importable, not the house, so memoize it.
// Keyed by object identity, so a reparse (fresh objects) can never read a stale
// hash — the old objects fall out of the WeakMap on GC.
const hashByImportable = new WeakMap<Importable, string>();

export function memoizedImportableHash(importable: Importable): string {
    const cached = hashByImportable.get(importable);
    if (cached !== undefined) return cached;
    const computed = importableHash(importable);
    hashByImportable.set(importable, computed);
    return computed;
}

/** Pre-seed the hash for an importable so the next build skips recomputing it.
 * Used by the parse-snapshot loader to reuse hashes computed in a prior session. */
export function seedImportableHash(importable: Importable, hash: string): void {
    hashByImportable.set(importable, hash);
}

export function buildCacheStatusRows(
    housingUuid: string,
    importables: readonly Importable[]
): CacheStatusRow[] {
    const measure = importables.length > 10;
    if (measure) resetHashBreakdown();
    const tHash0 = measure ? Date.now() : 0;
    const hashes = importables.map(memoizedImportableHash);
    const hashMs = measure ? Date.now() - tHash0 : 0;

    const tRead0 = measure ? Date.now() : 0;
    const rows = importables.map((importable, i): CacheStatusRow => {
        const identity = importableIdentity(importable);
        const hash = hashes[i];
        const entry = readImportableCache(housingUuid, importable.type, identity);
        const state =
            entry === null ? "unknown" : entry.hash === hash ? "current" : "modified";
        return { importable, identity, hash, state, entry };
    });
    if (measure) {
        const b = getHashBreakdown();
        ChatLib.chat(`&8[kb-timing] ${importables.length} — hash ${hashMs}ms (norm ${b.normMs} / str ${b.strMs} / dig ${b.digMs}), read ${Date.now() - tRead0}ms`);
    }
    return rows;
}
