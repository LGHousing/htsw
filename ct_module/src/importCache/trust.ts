import type { Action, Importable } from "htsw/types";

import { cacheEntryHash, readImportableCache, type ImportableCacheEntry } from "./cache";
import { actionHash, conditionHash, importableHash } from "./hash";
import { importableIdentity, importableKey } from "../importables/identity";
import { cacheEntryListHashes, sameHashList } from "./status";
import { matchByHash } from "./actionMatch";
import { actionListsOfImportable, readCachedActionList } from "./actionLists";
import type {
    TrustedChildListPath,
    TrustedChildListSnapshot,
} from "../housingSync/actions/applyTrust";
import { houseLockEntryFor, readHouseLock, type HouseLock } from "./houseLock";
import type { ContentHashJournalEntry } from "./houseLock";
import {
    itemDependencyIndexFor,
    sameItemDependencySnapshot,
    type ItemDependencyIndex,
} from "../importables/items/dependencyIndex";
import {
    hasItemClickActions,
    hasRequiredInteractDataCache,
} from "../importables/items/interactDataCache";
import {
    readStagedActionListHydration,
    type StagedActionListHydration,
} from "./stagedHydration";

export type {
    TrustedChildListPath,
    TrustedChildListSnapshot,
} from "../housingSync/actions/applyTrust";

export type ImportableTrustPlan = {
    importable: Importable;
    identity: string;
    entry: ImportableCacheEntry | null;
    sourceHash: string;
    cacheHash: string | null;
    lockHash: string | null;
    lockListScanHashes: Record<string, string> | null;
    lockListContentHashes: Record<string, string> | null;
    lockListContentHashJournal?: Record<string, ContentHashJournalEntry[]> | null;
    cacheMatchesLock: boolean;
    breakdown: {
        dependenciesMatch: boolean;
        itemBlobAvailable: boolean;
        cacheMatchesLock: boolean;
    };
    trustMode: boolean;
    wholeImportableTrusted: boolean;
    trustedChildListPaths: Set<TrustedChildListPath>;
    trustedChildLists: Map<TrustedChildListPath, TrustedChildListSnapshot>;
    stagedActionLists?: Map<string, StagedActionListHydration>;
};

export type TrustPlan = {
    housingUuid: string;
    trustMode: boolean;
    importables: Map<string, ImportableTrustPlan>;
};

/**
 * Build per-importable cache + trust info for an import session.
 *
 * Always loads each importable's cache entry (when one exists) so
 * the cached state can flow into ETA estimation regardless of
 * trust-mode. The `trustMode` flag only controls whether matching
 * hashes get registered as trusted lists. Those trusted lists carry both
 * the path proof and the cached child-list data used to complete observed
 * actions without opening the Housing editor. Pass `false` to get cache
 * data without any skip behavior.
 */
export function buildTrustPlan(
    housingUuid: string,
    importables: readonly Importable[],
    trustMode: boolean = true,
    importJsonPath?: string,
    itemDependencies?: ItemDependencyIndex
): TrustPlan {
    const plans = new Map<string, ImportableTrustPlan>();
    const lock = importJsonPath === undefined ? null : readHouseLock(importJsonPath);

    for (const importable of importables) {
        const identity = importableIdentity(importable);
        const entry = readImportableCache(housingUuid, importable.type, identity);
        const trustedChildListPaths = new Set<TrustedChildListPath>();
        const trustedChildLists = new Map<
            TrustedChildListPath,
            TrustedChildListSnapshot
        >();
        const stagedActionLists = new Map<string, StagedActionListHydration>();
        for (const { basePath } of actionListsOfImportable(importable)) {
            const staged = readStagedActionListHydration(
                housingUuid,
                importable.type,
                identity,
                basePath
            );
            if (staged !== null) stagedActionLists.set(basePath, staged);
        }

        let sourceHash: string | null = null;
        let wholeImportableTrusted = false;

        const lockEntry = lockEntryForImportable(
            lock,
            housingUuid,
            importable.type,
            identity
        );
        const entryHash = entry === null ? null : cacheEntryHash(entry);
        const dependencyIndex = itemDependencies ?? itemDependencyIndexFor(importable);
        const dependencySnapshot = dependencyIndex?.snapshotOf(importable);
        const dependenciesMatch =
            dependencySnapshot === undefined ||
            sameItemDependencySnapshot(entry?.itemDependencies, dependencySnapshot);
        const itemBlobAvailable =
            entry === null ||
            entry.importable.type !== "ITEM" ||
            !hasItemClickActions(entry.importable) ||
            (dependencyIndex !== undefined &&
                hasRequiredInteractDataCache(
                    entry.importable,
                    dependencyIndex,
                    housingUuid
                ));
        const cacheMatchesLock =
            lockEntry === null ||
            (entryHash === lockEntry.hash &&
                sameItemDependencySnapshot(
                    entry?.itemDependencies,
                    lockEntry.itemDependencies
                ));
        const trustAllowed =
            trustMode && cacheMatchesLock && dependenciesMatch && itemBlobAvailable;

        if (trustAllowed && entry !== null) {
            sourceHash = importableHash(importable);
            // Recompute rather than trust the stored entry.hash — see
            // cacheEntryHash: a hash-function change must not strand old
            // entries as permanently untrusted.
            wholeImportableTrusted = entryHash === sourceHash;

            if (!wholeImportableTrusted) {
                const cachedLists = cacheEntryListHashes(entry);
                const remapped = trustedChildListPathsForImportable(
                    importable,
                    cachedLists
                );
                remapped.forEach((path) => trustedChildListPaths.add(path));
                const snapshots = trustedChildListSnapshotsForImportable(
                    importable,
                    entry.importable,
                    cachedLists
                );
                snapshots.forEach((snapshot, path) => {
                    trustedChildListPaths.add(path);
                    trustedChildLists.set(path, snapshot);
                });
            }
        }

        plans.set(importableKey(importable.type, identity), {
            importable,
            identity,
            entry,
            sourceHash: sourceHash ?? "",
            cacheHash: entry?.hash ?? null,
            lockHash: lockEntry?.hash ?? null,
            lockListScanHashes: lockEntry?.listScanHashes ?? null,
            lockListContentHashes: lockEntry?.listContentHashes ?? null,
            lockListContentHashJournal: lockEntry?.listContentHashJournal ?? null,
            cacheMatchesLock,
            breakdown: {
                dependenciesMatch,
                itemBlobAvailable,
                cacheMatchesLock,
            },
            trustMode: trustAllowed,
            wholeImportableTrusted,
            trustedChildListPaths,
            trustedChildLists,
            stagedActionLists,
        });
    }

    return {
        housingUuid,
        trustMode,
        importables: plans,
    };
}

function lockEntryForImportable(
    lock: HouseLock | null,
    housingUuid: string,
    type: Importable["type"],
    identity: string
) {
    if (lock === null) return null;
    if (lock.houseUuid !== null && lock.houseUuid !== housingUuid) {
        return {
            hash: "",
            listScanHashes: undefined,
            listContentHashes: undefined,
            listContentHashJournal: undefined,
            itemDependencies: undefined,
        };
    }
    return houseLockEntryFor(lock, type, identity);
}

export function trustedChildListSnapshotsForImportable(
    importable: Importable,
    cachedImportable: Importable,
    cachedLists: Partial<Record<string, string[]>>
): Map<TrustedChildListPath, TrustedChildListSnapshot> {
    const trusted = new Map<TrustedChildListPath, TrustedChildListSnapshot>();
    for (const { basePath, actions } of actionListsOfImportable(importable)) {
        const cachedActions = readCachedActionList(cachedImportable, basePath);
        if (cachedActions === undefined) continue;
        collectTrustedActionListSnapshots(
            trusted,
            basePath,
            basePath,
            actions,
            cachedActions,
            cachedLists
        );
    }
    return trusted;
}

export function trustedChildListPathsForImportable(
    importable: Importable,
    cachedLists: Partial<Record<string, string[]>>
): Set<TrustedChildListPath> {
    const trusted = new Set<TrustedChildListPath>();
    for (const { basePath, actions } of actionListsOfImportable(importable)) {
        collectTrustedActionListPaths(trusted, basePath, basePath, actions, cachedLists);
    }
    return trusted;
}

function collectTrustedActionListSnapshots(
    trusted: Map<TrustedChildListPath, TrustedChildListSnapshot>,
    desiredPath: string,
    cachedPath: string,
    desiredActions: readonly Action[],
    cachedActions: readonly Action[],
    cachedLists: Partial<Record<string, string[]>>
): void {
    const desiredHashes = desiredActions.map(actionHash);
    const cachedHashes = cachedLists[cachedPath];
    if (sameHashList(cachedHashes, desiredHashes)) {
        trusted.set(desiredPath, {
            kind: "actions",
            actions: cachedActions,
        });
    }

    const matched = matchByHash(desiredHashes, cachedHashes);
    for (let i = 0; i < desiredActions.length; i++) {
        const cachedIndex = matched[i];
        if (cachedIndex === null) continue;
        if (cachedIndex < 0 || cachedIndex >= cachedActions.length) continue;
        const action = desiredActions[i];
        const cachedAction = cachedActions[cachedIndex];
        if (cachedAction.type !== action.type) continue;

        const desiredChildBase = `${desiredPath}[${i}]`;
        const cachedChildBase = `${cachedPath}[${cachedIndex}]`;
        if (action.type === "CONDITIONAL" && cachedAction.type === "CONDITIONAL") {
            const conditions = action.conditions;
            const desiredConditionsPath = `${desiredChildBase}.conditions`;
            const cachedConditionsPath = `${cachedChildBase}.conditions`;
            if (
                sameHashList(
                    cachedLists[cachedConditionsPath],
                    conditions.map(conditionHash)
                )
            ) {
                trusted.set(desiredConditionsPath, {
                    kind: "conditions",
                    conditions: cachedAction.conditions,
                });
            }
            collectTrustedActionListSnapshots(
                trusted,
                `${desiredChildBase}.ifActions`,
                `${cachedChildBase}.ifActions`,
                action.ifActions,
                cachedAction.ifActions,
                cachedLists
            );
            collectTrustedActionListSnapshots(
                trusted,
                `${desiredChildBase}.elseActions`,
                `${cachedChildBase}.elseActions`,
                action.elseActions,
                cachedAction.elseActions,
                cachedLists
            );
        } else if (action.type === "RANDOM" && cachedAction.type === "RANDOM") {
            collectTrustedActionListSnapshots(
                trusted,
                `${desiredChildBase}.actions`,
                `${cachedChildBase}.actions`,
                action.actions,
                cachedAction.actions,
                cachedLists
            );
        }
    }
}

function collectTrustedActionListPaths(
    trusted: Set<TrustedChildListPath>,
    desiredPath: string,
    cachedPath: string,
    desiredActions: readonly Action[],
    cachedLists: Partial<Record<string, string[]>>
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
            const conditions = action.conditions;
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
                action.ifActions,
                cachedLists
            );
            collectTrustedActionListPaths(
                trusted,
                `${desiredChildBase}.elseActions`,
                `${cachedChildBase}.elseActions`,
                action.elseActions,
                cachedLists
            );
        } else if (action.type === "RANDOM") {
            collectTrustedActionListPaths(
                trusted,
                `${desiredChildBase}.actions`,
                `${cachedChildBase}.actions`,
                action.actions,
                cachedLists
            );
        }
    }
}
