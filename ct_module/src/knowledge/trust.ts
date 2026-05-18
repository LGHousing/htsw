import type { Importable } from "htsw/types";

import type { KnowledgeEntry } from "./cache";
import { importableHash, listHashes } from "./hash";
import { importableIdentity } from "./paths";
import { readKnowledge } from "./cache";
import { sameHashList } from "./status";

type TrustedListPath = string;

export type ImportableTrustPlan = {
    importable: Importable;
    identity: string;
    entry: KnowledgeEntry | null;
    sourceHash: string;
    cacheHash: string | null;
    wholeImportableTrusted: boolean;
    trustedListPaths: Set<TrustedListPath>;
};

export type KnowledgeTrustPlan = {
    housingUuid: string;
    importables: Map<string, ImportableTrustPlan>;
};

export function trustPlanKey(type: Importable["type"], identity: string): string {
    return `${type}:${identity}`;
}

/**
 * Build per-importable cache + trust info for an import session.
 *
 * Always loads each importable's knowledge entry (when one exists) so
 * the cached state can flow into ETA estimation regardless of
 * trust-mode. The `trustMode` flag only controls whether matching
 * hashes get registered as `trustedListPaths` (which cause the
 * importer to *skip* those lists). Pass `false` to get cache data
 * without any skip behavior.
 */
export function buildKnowledgeTrustPlan(
    housingUuid: string,
    importables: readonly Importable[],
    trustMode: boolean = true
): KnowledgeTrustPlan {
    const plans = new Map<string, ImportableTrustPlan>();

    for (const importable of importables) {
        const identity = importableIdentity(importable);
        const sourceHash = importableHash(importable);
        const entry = readKnowledge(housingUuid, importable.type, identity);
        const desiredLists = listHashes(importable);
        const trustedListPaths = new Set<TrustedListPath>();

        if (trustMode && entry !== null) {
            for (const path of Object.keys(desiredLists)) {
                if (sameHashList(entry.lists[path], desiredLists[path])) {
                    trustedListPaths.add(path);
                }
            }
        }

        plans.set(trustPlanKey(importable.type, identity), {
            importable,
            identity,
            entry,
            sourceHash,
            cacheHash: entry?.hash ?? null,
            wholeImportableTrusted:
                trustMode && entry !== null && entry.hash === sourceHash,
            trustedListPaths,
        });
    }

    return {
        housingUuid,
        importables: plans,
    };
}
