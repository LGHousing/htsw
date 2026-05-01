import type { Importable } from "htsw/types";

import type { KnowledgeEntry } from "./cache";
import { importableHash, listHashes } from "./hash";
import { importableIdentity } from "./paths";
import { readKnowledge } from "./cache";
import { sameHashList } from "./status";

export type TrustedListPath = string;

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

export function buildKnowledgeTrustPlan(
    housingUuid: string,
    importables: readonly Importable[]
): KnowledgeTrustPlan {
    const plans = new Map<string, ImportableTrustPlan>();

    for (const importable of importables) {
        const identity = importableIdentity(importable);
        const sourceHash = importableHash(importable);
        const entry = readKnowledge(housingUuid, importable.type, identity);
        const desiredLists = listHashes(importable);
        const trustedListPaths = new Set<TrustedListPath>();

        if (entry !== null) {
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
            wholeImportableTrusted: entry !== null && entry.hash === sourceHash,
            trustedListPaths,
        });
    }

    return {
        housingUuid,
        importables: plans,
    };
}
