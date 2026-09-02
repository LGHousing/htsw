import type { Importable } from "htsw/types";

import type TaskContext from "../tasks/context";
import { importableIdentity } from "../importables/identity";
import { importableHash } from "./hash";
import {
    houseLockEntryFor,
    readHouseLock,
    type HouseLock,
    type HouseLockEntry,
} from "./houseLock";
import { readImportableCache, writeImportableCache, writePresence } from "./cache";
import {
    itemDependencyIndexFor,
    sameItemDependencySnapshot,
    type ItemDependencyIndex,
    type ItemDependencySnapshot,
} from "../importables/items/dependencyIndex";
import {
    hasItemClickActions,
    hasRequiredInteractDataCache,
} from "../importables/items/interactDataCache";

export type AcceptHouseLockResult =
    | { ok: false; reason: "missing-lock" }
    | { ok: false; reason: "unbound-lock" }
    | {
          ok: true;
          housingUuid: string;
          accepted: Importable[];
          markedPresent: number;
          skipped: number;
          failed: number;
      };

export type HouseLockCurrentEntry = {
    entry: HouseLockEntry;
    dependencySnapshot: ItemDependencySnapshot | undefined;
};

// The lock entry for `importable` when it describes the importable exactly as
// the project has it now (same hash, same item dependencies, and the ITEM
// interact-data blob it needs is cached). Only such entries can be copied
// into the Knowledge cache as "current"; anything else is null.
export function houseLockCurrentEntryFor(
    lock: HouseLock,
    housingUuid: string,
    importable: Importable,
    itemDependencies?: ItemDependencyIndex
): HouseLockCurrentEntry | null {
    const entry = houseLockEntryFor(lock, importable.type, importableIdentity(importable));
    if (entry === null || entry.hash !== importableHash(importable)) return null;
    const dependencyIndex = itemDependencies ?? itemDependencyIndexFor(importable);
    const dependencySnapshot = dependencyIndex?.snapshotOf(importable);
    const dependenciesMatch =
        dependencySnapshot === undefined
            ? entry.itemDependencies === undefined
            : sameItemDependencySnapshot(entry.itemDependencies, dependencySnapshot);
    if (!dependenciesMatch) return null;
    const itemBlobAvailable =
        importable.type !== "ITEM" ||
        !hasItemClickActions(importable) ||
        (dependencyIndex !== undefined &&
            hasRequiredInteractDataCache(importable, dependencyIndex, housingUuid));
    if (!itemBlobAvailable) return null;
    return { entry, dependencySnapshot };
}

export function acceptHouseLockAsCurrent(
    ctx: TaskContext,
    importJsonPath: string,
    importables: readonly Importable[],
    itemDependencies?: ItemDependencyIndex
): AcceptHouseLockResult {
    const lock = readHouseLock(importJsonPath);
    if (lock === null) return { ok: false, reason: "missing-lock" };
    if (lock.houseUuid === null) return { ok: false, reason: "unbound-lock" };
    const housingUuid = lock.houseUuid;

    const accepted: Importable[] = [];
    let markedPresent = 0;
    let skipped = 0;
    let failed = 0;
    for (const importable of importables) {
        const current = houseLockCurrentEntryFor(
            lock,
            housingUuid,
            importable,
            itemDependencies
        );
        if (current === null) {
            const entry = houseLockEntryFor(
                lock,
                importable.type,
                importableIdentity(importable)
            );
            const identity = importableIdentity(importable);
            if (
                entry !== null &&
                readImportableCache(housingUuid, importable.type, identity) === null &&
                writePresence(
                    housingUuid,
                    importable.type,
                    identity,
                    undefined,
                    importable.type === "FUNCTION" ? importable.icon : undefined
                )
            ) {
                markedPresent++;
            } else {
                skipped++;
            }
            continue;
        }
        if (
            writeImportableCache(ctx, housingUuid, importable, "project-lock", {
                itemDependencies: current.dependencySnapshot,
            })
        ) {
            accepted.push(importable);
        } else {
            failed++;
        }
    }

    return { ok: true, housingUuid, accepted, markedPresent, skipped, failed };
}
