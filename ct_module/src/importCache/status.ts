import type { Importable } from "htsw/types";

import type { ImportableCacheEntry } from "./cache";
import { importableHash } from "./hash";
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

export function buildCacheStatusRows(
    housingUuid: string,
    importables: readonly Importable[]
): CacheStatusRow[] {
    return importables.map((importable) => {
        const identity = importableIdentity(importable);
        const hash = importableHash(importable);
        const entry = readImportableCache(housingUuid, importable.type, identity);
        const state =
            entry === null ? "unknown" : entry.hash === hash ? "current" : "modified";
        return {
            importable,
            identity,
            hash,
            state,
            entry,
        };
    });
}
