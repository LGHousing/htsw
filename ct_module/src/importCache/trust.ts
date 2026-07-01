import type { Action, Condition, Importable } from "htsw/types";

import type { ImportableCacheEntry } from "./cache";
import { actionHash, conditionHash, importableHash } from "./hash";
import { importableIdentity, importableKey } from "../importables/identity";
import { readImportableCache } from "./cache";
import { cacheEntryHash, cacheEntryListHashes, sameHashList } from "./status";
import { matchByHash } from "./actionMatch";
import { readCachedActionList } from "./actionLists";

export type TrustedChildListPath = string;

export type TrustedChildListSnapshot =
    | { kind: "actions"; actions: readonly Action[] }
    | { kind: "conditions"; conditions: readonly Condition[] };

export type ImportableTrustPlan = {
    importable: Importable;
    identity: string;
    entry: ImportableCacheEntry | null;
    sourceHash: string;
    cacheHash: string | null;
    trustMode: boolean;
    wholeImportableTrusted: boolean;
    trustedChildListPaths: Set<TrustedChildListPath>;
    trustedChildLists: Map<TrustedChildListPath, TrustedChildListSnapshot>;
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
 * hashes get registered as trusted lists. Those trusted lists carry both
 * the path proof and the cached child-list data used to complete observed
 * actions without opening the Housing editor. Pass `false` to get cache
 * data without any skip behavior.
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
        const trustedChildListPaths = new Set<TrustedChildListPath>();
        const trustedChildLists = new Map<TrustedChildListPath, TrustedChildListSnapshot>();

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
                const remapped = trustedChildListPathsForImportable(importable, cachedLists);
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
            trustMode,
            wholeImportableTrusted,
            trustedChildListPaths,
            trustedChildLists,
        });
    }

    return {
        housingUuid,
        importables: plans,
    };
}

export function trustedChildListSnapshotsForImportable(
    importable: Importable,
    cachedImportable: Importable,
    cachedLists: Record<string, string[]>
): Map<TrustedChildListPath, TrustedChildListSnapshot> {
    const trusted = new Map<TrustedChildListPath, TrustedChildListSnapshot>();
    forEachTopLevelActionList(importable, (path, actions) => {
        const cachedActions = readCachedActionList(cachedImportable, path);
        if (cachedActions === undefined) return;
        collectTrustedActionListSnapshots(
            trusted,
            path,
            path,
            actions,
            cachedActions,
            cachedLists
        );
    });
    return trusted;
}

export function trustedChildListPathsForImportable(
    importable: Importable,
    cachedLists: Record<string, string[]>
): Set<TrustedChildListPath> {
    const trusted = new Set<TrustedChildListPath>();
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

function collectTrustedActionListSnapshots(
    trusted: Map<TrustedChildListPath, TrustedChildListSnapshot>,
    desiredPath: string,
    cachedPath: string,
    desiredActions: readonly Action[],
    cachedActions: readonly Action[],
    cachedLists: Record<string, string[]>
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
        const action = desiredActions[i];
        const cachedAction = cachedActions[cachedIndex];
        if (cachedAction === undefined || cachedAction.type !== action.type) continue;

        const desiredChildBase = `${desiredPath}[${i}]`;
        const cachedChildBase = `${cachedPath}[${cachedIndex}]`;
        if (action.type === "CONDITIONAL" && cachedAction.type === "CONDITIONAL") {
            const conditions = action.conditions ?? [];
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
                    conditions: cachedAction.conditions ?? [],
                });
            }
            collectTrustedActionListSnapshots(
                trusted,
                `${desiredChildBase}.ifActions`,
                `${cachedChildBase}.ifActions`,
                action.ifActions ?? [],
                cachedAction.ifActions ?? [],
                cachedLists
            );
            collectTrustedActionListSnapshots(
                trusted,
                `${desiredChildBase}.elseActions`,
                `${cachedChildBase}.elseActions`,
                action.elseActions ?? [],
                cachedAction.elseActions ?? [],
                cachedLists
            );
        } else if (action.type === "RANDOM" && cachedAction.type === "RANDOM") {
            collectTrustedActionListSnapshots(
                trusted,
                `${desiredChildBase}.actions`,
                `${cachedChildBase}.actions`,
                action.actions ?? [],
                cachedAction.actions ?? [],
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
