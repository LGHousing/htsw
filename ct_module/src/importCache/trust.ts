import type { Importable } from "htsw/types";

import type { ImportableCacheEntry } from "./cache";
import { importableHash, listHashes } from "./hash";
import { importableIdentity, importableKey } from "./paths";
import { readImportableCache } from "./cache";
import { sameHashList } from "./status";

type TrustedListPath = string;

export type ImportableTrustPlan = {
    importable: Importable;
    identity: string;
    entry: ImportableCacheEntry | null;
    sourceHash: string;
    cacheHash: string | null;
    wholeImportableTrusted: boolean;
    trustedListPaths: Set<TrustedListPath>;
};

export type TrustPlan = {
    housingUuid: string;
    importables: Map<string, ImportableTrustPlan>;
};

/**
 * Build per-importable cache + trust info for an import session.
 *
 * Always loads each importable's cache entry (when one exists) so
 * the cached state can flow into ETA estimation regardless of
 * trust-mode. The `trustMode` flag only controls whether matching
 * hashes get registered as `trustedListPaths` (which cause the
 * importer to *skip* those lists). Pass `false` to get cache data
 * without any skip behavior.
 */
export function buildTrustPlan(
    housingUuid: string,
    importables: readonly Importable[],
    trustMode: boolean = true
): TrustPlan {
    const plans = new Map<string, ImportableTrustPlan>();

    for (const importable of importables) {
        const identity = importableIdentity(importable);
        const entry = readImportableCache(housingUuid, importable.type, identity);
        const trustedListPaths = new Set<TrustedListPath>();

        let sourceHash: string | null = null;
        let wholeImportableTrusted = false;

        if (trustMode && entry !== null) {
            sourceHash = importableHash(importable);
            wholeImportableTrusted = entry.hash === sourceHash;

            if (!wholeImportableTrusted) {
                const desiredLists = listHashes(importable);
                for (const path of Object.keys(desiredLists)) {
                    if (sameHashList(entry.lists[path], desiredLists[path])) {
                        trustedListPaths.add(path);
                    }
                }
            }
        }

        plans.set(importableKey(importable.type, identity), {
            importable,
            identity,
            entry,
            sourceHash: sourceHash ?? "",
            cacheHash: entry?.hash ?? null,
            wholeImportableTrusted,
            trustedListPaths,
        });
    }

    return {
        housingUuid,
        importables: plans,
    };
}
