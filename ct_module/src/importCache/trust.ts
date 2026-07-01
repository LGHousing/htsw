import type { Action, Importable } from "htsw/types";

import type { ImportableCacheEntry } from "./cache";
import { actionHash, conditionHash, importableHash } from "./hash";
import { importableIdentity, importableKey } from "../importables/identity";
import { readImportableCache } from "./cache";
import { cacheEntryHash, cacheEntryListHashes, sameHashList } from "./status";
import { matchByHash } from "./actionMatch";

export type TrustedListPath = string;

export type ImportableTrustPlan = {
    importable: Importable;
    identity: string;
    entry: ImportableCacheEntry | null;
    sourceHash: string;
    cacheHash: string | null;
    trustMode: boolean;
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
            // Recompute rather than trust the stored entry.hash — see
            // cacheEntryHash: a hash-function change must not strand old
            // entries as permanently untrusted.
            wholeImportableTrusted = cacheEntryHash(entry) === sourceHash;

            if (!wholeImportableTrusted) {
                const cachedLists = cacheEntryListHashes(entry);
                const remapped = trustedListPathsForImportable(importable, cachedLists);
                remapped.forEach((path) => trustedListPaths.add(path));
            }
        }

        plans.set(importableKey(importable.type, identity), {
            importable,
            identity,
            entry,
            sourceHash: sourceHash ?? "",
            cacheHash: entry?.hash ?? null,
            trustMode,
            wholeImportableTrusted,
            trustedListPaths,
        });
    }

    return {
        housingUuid,
        importables: plans,
    };
}

export function trustedListPathsForImportable(
    importable: Importable,
    cachedLists: Record<string, string[]>
): Set<TrustedListPath> {
    const trusted = new Set<TrustedListPath>();
    forEachTopLevelActionList(importable, (path, actions) => {
        collectTrustedActionListPaths(trusted, path, path, actions, cachedLists);
    });
    return trusted;
}

function forEachTopLevelActionList(
    importable: Importable,
    visit: (path: string, actions: readonly Action[]) => void
): void {
    switch (importable.type) {
        case "FUNCTION":
            visit("actions", importable.actions ?? []);
            break;
        case "COMMAND":
            if (importable.actions !== undefined) {
                visit("actions", importable.actions);
            }
            break;
        case "EVENT":
            visit("actions", importable.actions);
            break;
        case "REGION":
            if (importable.onEnterActions !== undefined) {
                visit("onEnterActions", importable.onEnterActions);
            }
            if (importable.onExitActions !== undefined) {
                visit("onExitActions", importable.onExitActions);
            }
            break;
        case "ITEM":
            if (importable.leftClickActions !== undefined) {
                visit("leftClickActions", importable.leftClickActions);
            }
            if (importable.rightClickActions !== undefined) {
                visit("rightClickActions", importable.rightClickActions);
            }
            break;
        case "NPC":
            if (importable.leftClickActions !== undefined) {
                visit("leftClickActions", importable.leftClickActions);
            }
            if (importable.rightClickActions !== undefined) {
                visit("rightClickActions", importable.rightClickActions);
            }
            break;
        case "MENU":
            for (let i = 0; i < importable.slots.length; i++) {
                const actions = importable.slots[i].actions;
                if (actions !== undefined && actions.length > 0) {
                    visit(`slots[${i}].actions`, actions);
                }
            }
            break;
    }
}

function collectTrustedActionListPaths(
    trusted: Set<TrustedListPath>,
    desiredPath: string,
    cachedPath: string,
    desiredActions: readonly Action[],
    cachedLists: Record<string, string[]>
): void {
    const desiredHashes = desiredActions.map(actionHash);
    const cachedHashes = cachedLists[cachedPath];
    if (sameHashList(cachedHashes, desiredHashes)) {
        trusted.add(desiredPath);
    }

    const matched = matchByHash(desiredHashes, cachedHashes);
    for (let i = 0; i < desiredActions.length; i++) {
        const cachedIndex = matched[i];
        if (cachedIndex === null) continue;
        const action = desiredActions[i];
        const desiredChildBase = `${desiredPath}[${i}]`;
        const cachedChildBase = `${cachedPath}[${cachedIndex}]`;
        if (action.type === "CONDITIONAL") {
            const conditions = action.conditions ?? [];
            const desiredConditionsPath = `${desiredChildBase}.conditions`;
            const cachedConditionsPath = `${cachedChildBase}.conditions`;
            if (
                sameHashList(
                    cachedLists[cachedConditionsPath],
                    conditions.map(conditionHash)
                )
            ) {
                trusted.add(desiredConditionsPath);
            }
            collectTrustedActionListPaths(
                trusted,
                `${desiredChildBase}.ifActions`,
                `${cachedChildBase}.ifActions`,
                action.ifActions ?? [],
                cachedLists
            );
            collectTrustedActionListPaths(
                trusted,
                `${desiredChildBase}.elseActions`,
                `${cachedChildBase}.elseActions`,
                action.elseActions ?? [],
                cachedLists
            );
        } else if (action.type === "RANDOM") {
            collectTrustedActionListPaths(
                trusted,
                `${desiredChildBase}.actions`,
                `${cachedChildBase}.actions`,
                action.actions ?? [],
                cachedLists
            );
        }
    }
}
