import { afterEach, describe, expect, it, vi } from "vitest";
import type {
    Action,
    ImportableCommand,
    ImportableFunction,
    ImportableItem,
    ImportableNpc,
} from "htsw/types";

import type { ImportableCacheEntry } from "../src/importCache/cache";
import { importableHash, listHashes } from "../src/importCache/hash";
import {
    buildTrustPlan,
    trustedChildListPathsForImportable,
    trustedChildListSnapshotsForImportable,
} from "../src/importCache/trust";
import { estimateImportableUnits } from "../src/housingSync/progress/costs";
import { readActionListSync } from "../src/housingSync/actions/prepareSync";
import { createProjectItemIndex } from "../src/importables/items/projectItems";
import { createItemFieldResolver } from "../src/importables/items/resolveItem";
import type { ActionSyncContext } from "../src/housingSync/actions/syncContext";
import type TaskContext from "../src/tasks/context";
import {
    createItemDependencyIndex,
    type ItemDependencyIndex,
    type ItemDependencySnapshot,
} from "../src/importables/items/dependencyIndex";
import { buildCacheStatusRow } from "../src/importCache/status";
import { exportedItemDependencies } from "../src/importables/items/exportedDependencies";

function chat(message: string): Action {
    return { type: "MESSAGE", message };
}

function conditional(ifActions: Action[]): Action {
    return {
        type: "CONDITIONAL",
        matchAny: false,
        conditions: [],
        ifActions,
        elseActions: [],
    };
}

function fn(actions: Action[]): ImportableFunction {
    return { type: "FUNCTION", name: "Debug", actions };
}

function cacheEntry(importable: ImportableFunction): ImportableCacheEntry {
    return {
        schemaVersion: 2,
        writtenAt: "2026-06-27T00:00:00.000Z",
        writer: "importer",
        importable,
        hash: "unused",
        lists: listHashes(importable),
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("exported item dependency trust", () => {
    const referencedItem: ImportableItem = {
        type: "ITEM",
        name: "Key",
        nbt: {
            type: "compound",
            value: {
                id: { type: "string", value: "minecraft:tripwire_hook" },
            },
        },
    };
    const owner: ImportableFunction = {
        type: "FUNCTION",
        name: "Use Key",
        actions: [{ type: "GIVE_ITEM", itemName: "Key" }],
    };

    it("whole-trusts an exporter cache entry when every referenced item was captured", () => {
        const importables = [referencedItem, owner];
        const items = createProjectItemIndex(importables);
        const dependencies = createItemDependencyIndex(importables, items);
        const itemDependencies = exportedItemDependencies(
            owner,
            dependencies,
            new Set(["Key"])
        );
        const uuid = "export-captured-dependencies";
        const entry = {
            ...cacheEntry(owner),
            writer: "exporter" as const,
            itemDependencies,
        };
        const files: Partial<Record<string, string>> = {
            [`./htsw/.cache/${uuid}/function/Use_0020Key.knowledge.json`]:
                JSON.stringify(entry),
        };
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files[path] !== undefined,
            read: (path: string) => files[path] ?? null,
            write: () => undefined,
        });

        expect(itemDependencies).toEqual(dependencies.snapshotOf(owner));
        expect(
            buildTrustPlan(uuid, importables, true, undefined, dependencies)
                .importables.get("FUNCTION:Use Key")?.wholeImportableTrusted
        ).toBe(true);
    });

    it("omits an uncaptured reference and does not whole-trust the cache entry", () => {
        const importables = [referencedItem, owner];
        const items = createProjectItemIndex(importables);
        const dependencies = createItemDependencyIndex(importables, items);
        const itemDependencies = exportedItemDependencies(
            owner,
            dependencies,
            new Set()
        );
        const uuid = "export-uncaptured-dependencies";
        const entry = {
            ...cacheEntry(owner),
            writer: "exporter" as const,
            itemDependencies,
        };
        const files: Partial<Record<string, string>> = {
            [`./htsw/.cache/${uuid}/function/Use_0020Key.knowledge.json`]:
                JSON.stringify(entry),
        };
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files[path] !== undefined,
            read: (path: string) => files[path] ?? null,
            write: () => undefined,
        });

        expect(itemDependencies.dependencies).toEqual([]);
        expect(
            buildTrustPlan(uuid, importables, true, undefined, dependencies)
                .importables.get("FUNCTION:Use Key")?.wholeImportableTrusted
        ).toBe(false);
    });
});

describe("trustedChildListPathsForImportable", () => {
    it("trusts unchanged child lists after a top-level insertion shifts indexes", () => {
        const cached = fn([conditional([chat("inside")])]);
        const desired = fn([chat("debug"), conditional([chat("inside")])]);

        const trusted = trustedChildListPathsForImportable(desired, listHashes(cached));
        const snapshots = trustedChildListSnapshotsForImportable(
            desired,
            cached,
            listHashes(cached)
        );

        expect(trusted.has("actions")).toBe(false);
        expect(trusted.has("actions[1].ifActions")).toBe(true);
        expect(trusted.has("actions[0].ifActions")).toBe(false);
        expect(snapshots.get("actions[1].ifActions")).toEqual({
            kind: "actions",
            actions: [chat("inside")],
        });
    });

    it("does not trust a child list that changed under a matched parent", () => {
        const cached = fn([conditional([chat("inside")])]);
        const desired = fn([conditional([chat("debug"), chat("inside")])]);

        const trusted = trustedChildListPathsForImportable(desired, listHashes(cached));
        const snapshots = trustedChildListSnapshotsForImportable(
            desired,
            cached,
            listHashes(cached)
        );

        expect(trusted.has("actions")).toBe(false);
        expect(trusted.has("actions[0].ifActions")).toBe(false);
        expect(trusted.has("actions[0].elseActions")).toBe(true);
        expect(snapshots.get("actions[0].elseActions")).toEqual({
            kind: "actions",
            actions: [],
        });
    });

    it("does not estimate top-level hydration work for trusted cached baselines", () => {
        const cached = fn([conditional([chat("inside")])]);
        const desired = fn([conditional([chat("inside"), chat("debug")])]);
        const entry = cacheEntry(cached);

        const trustOff = estimateImportableUnits(desired, entry, false);
        const trustOn = estimateImportableUnits(desired, entry, true);

        expect(trustOn).toBeLessThan(trustOff);
    });

    it("does not trust a changed top-level list", () => {
        const cached = fn([chat("old")]);
        const desired = fn([chat("new")]);
        const trustedChildListPaths = trustedChildListPathsForImportable(
            desired,
            listHashes(cached)
        );

        expect(trustedChildListPaths.has("actions")).toBe(false);
    });

    it("trusts unchanged command actions when command settings changed", () => {
        const cached: ImportableCommand = {
            type: "COMMAND",
            name: "warp",
            actions: [chat("same")],
            listed: true,
        };
        const desired: ImportableCommand = {
            type: "COMMAND",
            name: "warp",
            actions: [chat("same")],
            listed: false,
        };

        const trusted = trustedChildListPathsForImportable(desired, listHashes(cached));

        expect(trusted.has("actions")).toBe(true);
    });

    it("trusts unchanged NPC click action lists independently", () => {
        const cached: ImportableNpc = {
            type: "NPC",
            name: "Guide",
            pos: { x: 1, y: 2, z: 3 },
            leftClickActions: [chat("same")],
            rightClickActions: [chat("old")],
        };
        const desired: ImportableNpc = {
            type: "NPC",
            name: "Guide",
            pos: { x: 1, y: 2, z: 3 },
            leftClickActions: [chat("same")],
            rightClickActions: [chat("new")],
        };

        const trusted = trustedChildListPathsForImportable(desired, listHashes(cached));

        expect(trusted.has("leftClickActions")).toBe(true);
        expect(trusted.has("rightClickActions")).toBe(false);
    });
});

describe("buildTrustPlan house lock gating", () => {
    it("does not trust item knowledge without its interaction blob", () => {
        const uuid = "missing-item-blob";
        const item: ImportableItem = {
            type: "ITEM",
            name: "Wand",
            nbt: { type: "compound", value: {} },
            rightClickActions: [chat("use")],
        };
        const entry: ImportableCacheEntry = {
            schemaVersion: 2,
            writtenAt: "2026-07-23T00:00:00.000Z",
            writer: "importer",
            importable: item,
            hash: importableHash(item),
            lists: listHashes(item),
            itemDependencies: { version: 1, dependencies: [] },
        };
        const files: Partial<Record<string, string>> = {
            [`./htsw/.cache/${uuid}/item/Wand.knowledge.json`]: JSON.stringify(entry),
        };
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files[path] !== undefined,
            read: (path: string) => files[path] ?? null,
            write: () => undefined,
        });
        const itemDependencies = {
            snapshotOf: () => ({ version: 1, dependencies: [] }),
            clickActionsFingerprint: () => "v2-missing",
        } as unknown as ItemDependencyIndex;

        const trust = buildTrustPlan(
            uuid,
            [item],
            true,
            undefined,
            itemDependencies
        ).importables.get("ITEM:Wand");

        expect(trust?.entry?.importable).toEqual(item);
        expect(trust?.trustMode).toBe(false);
        expect(trust?.wholeImportableTrusted).toBe(false);
        expect(trust?.breakdown.itemBlobAvailable).toBe(false);
    });

    it("exposes a dependency mismatch when cached item metadata is missing", () => {
        const uuid = "dependency-cache-missing";
        const desired = fn([chat("same")]);
        const entry = cacheEntry(desired);
        const files: Partial<Record<string, string>> = {
            [`./htsw/.cache/${uuid}/function/Debug.knowledge.json`]:
                JSON.stringify(entry),
        };
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files[path] !== undefined,
            read: (path: string) => files[path] ?? null,
            write: () => undefined,
        });
        const snapshot: ItemDependencySnapshot = {
            version: 1,
            dependencies: [
                {
                    target: { kind: "named", name: "Key" },
                    fingerprint: "0x123",
                },
            ],
        };
        const itemDependencies = {
            snapshotOf: () => snapshot,
        } as unknown as ItemDependencyIndex;

        const row = buildTrustPlan(
            uuid,
            [desired],
            true,
            undefined,
            itemDependencies
        ).importables.get("FUNCTION:Debug");

        expect(row?.wholeImportableTrusted).toBe(false);
        expect(row?.trustedChildListPaths.size).toBe(0);
        expect(row?.breakdown.dependenciesMatch).toBe(false);
        expect(buildCacheStatusRow(uuid, desired, itemDependencies).state).toBe(
            "modified"
        );
    });

    it("exposes matching dependencies for a matching snapshot", () => {
        const uuid = "dependency-cache-empty";
        const desired = fn([chat("same")]);
        const files: Partial<Record<string, string>> = {
            [`./htsw/.cache/${uuid}/function/Debug.knowledge.json`]: JSON.stringify(
                cacheEntry(desired)
            ),
        };
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files[path] !== undefined,
            read: (path: string) => files[path] ?? null,
            write: () => undefined,
        });
        const itemDependencies = {
            snapshotOf: () => ({ version: 1, dependencies: [] }),
        } as unknown as ItemDependencyIndex;

        expect(buildCacheStatusRow(uuid, desired, itemDependencies).state).toBe(
            "current"
        );
        expect(
            buildTrustPlan(
                uuid,
                [desired],
                true,
                undefined,
                itemDependencies
            ).importables.get("FUNCTION:Debug")?.breakdown.dependenciesMatch
        ).toBe(true);
    });

    it("exposes a lock mismatch when cache and project lock differ", () => {
        const uuid = "lock-test-mismatch";
        const importJsonPath = "./projects/demo/import.json";
        const cached = fn([chat("cached")]);
        const desired = fn([chat("cached")]);
        const entry = cacheEntry(cached);
        const files: Partial<Record<string, string>> = {
            [`./htsw/.cache/${uuid}/function/Debug.knowledge.json`]:
                JSON.stringify(entry),
            "./projects/demo/house.lock.json": JSON.stringify({
                schemaVersion: 1,
                houseUuid: uuid,
                importables: {
                    "FUNCTION:Debug": {
                        type: "FUNCTION",
                        identity: "Debug",
                        hash: importableHash(fn([chat("repo baseline")])),
                    },
                },
            }),
        };

        vi.stubGlobal("FileLib", {
            exists: (path: string) => files[path] !== undefined,
            read: (path: string) => files[path] ?? null,
            write: () => undefined,
        });

        const plan = buildTrustPlan(uuid, [desired], true, importJsonPath);
        const row = plan.importables.get("FUNCTION:Debug");

        expect(row?.entry?.importable).toEqual(cached);
        expect(row?.trustMode).toBe(false);
        expect(row?.wholeImportableTrusted).toBe(false);
        expect(row?.cacheMatchesLock).toBe(false);
        expect(row?.breakdown.cacheMatchesLock).toBe(false);
        expect(row?.lockListScanHashes).toBeNull();
    });

    it("keeps trust available when the local cache matches the project lock", () => {
        const uuid = "lock-test-match";
        const importJsonPath = "./projects/demo/import.json";
        const cached = fn([chat("same")]);
        const entry = cacheEntry(cached);
        const files: Partial<Record<string, string>> = {
            [`./htsw/.cache/${uuid}/function/Debug.knowledge.json`]:
                JSON.stringify(entry),
            "./projects/demo/house.lock.json": JSON.stringify({
                schemaVersion: 1,
                houseUuid: uuid,
                importables: {
                    "FUNCTION:Debug": {
                        type: "FUNCTION",
                        identity: "Debug",
                        hash: importableHash(cached),
                    },
                },
            }),
        };

        vi.stubGlobal("FileLib", {
            exists: (path: string) => files[path] !== undefined,
            read: (path: string) => files[path] ?? null,
            write: () => undefined,
        });

        const plan = buildTrustPlan(uuid, [cached], true, importJsonPath);
        const row = plan.importables.get("FUNCTION:Debug");

        expect(row?.trustMode).toBe(true);
        expect(row?.wholeImportableTrusted).toBe(true);
        expect(row?.cacheMatchesLock).toBe(true);
        expect(row?.lockListScanHashes).toBeNull();
    });

    it("keeps trust available when the project lock has no entry for the importable", () => {
        const uuid = "lock-test-missing-entry";
        const importJsonPath = "./projects/demo/import.json";
        const cached = fn([chat("same")]);
        const files: Partial<Record<string, string>> = {
            [`./htsw/.cache/${uuid}/function/Debug.knowledge.json`]:
                JSON.stringify(cacheEntry(cached)),
            "./projects/demo/house.lock.json": JSON.stringify({
                schemaVersion: 1,
                houseUuid: uuid,
                importables: {},
            }),
        };

        vi.stubGlobal("FileLib", {
            exists: (path: string) => files[path] !== undefined,
            read: (path: string) => files[path] ?? null,
            write: () => undefined,
        });

        const row = buildTrustPlan(
            uuid,
            [cached],
            true,
            importJsonPath
        ).importables.get("FUNCTION:Debug");

        expect(row?.trustMode).toBe(true);
        expect(row?.wholeImportableTrusted).toBe(true);
        expect(row?.cacheMatchesLock).toBe(true);
        expect(row?.lockHash).toBeNull();
    });

    it("exposes current-version lock scan hashes", () => {
        const uuid = "lock-test-scan-hash";
        const importJsonPath = "./projects/demo/import.json";
        const desired = fn([chat("same")]);
        const files: Partial<Record<string, string>> = {
            "./projects/demo/house.lock.json": JSON.stringify({
                schemaVersion: 1,
                houseUuid: uuid,
                scanHashVersion: 1,
                importables: {
                    "FUNCTION:Debug": {
                        type: "FUNCTION",
                        identity: "Debug",
                        hash: importableHash(desired),
                        listScanHashes: { actions: "0xscan" },
                    },
                },
            }),
        };

        vi.stubGlobal("FileLib", {
            exists: (path: string) => files[path] !== undefined,
            read: (path: string) => files[path] ?? null,
            write: () => undefined,
        });

        const row = buildTrustPlan(uuid, [desired], true, importJsonPath).importables.get(
            "FUNCTION:Debug"
        );

        expect(row?.lockListScanHashes).toEqual({ actions: "0xscan" });
    });
});

describe("trusted action-list planning", () => {
    it("plans a changed list from the lock-validated cache without opening Housing", async () => {
        const cached = fn([chat("old")]);
        const desired = fn([chat("new")]);
        const entry = cacheEntry(cached);
        const open = vi.fn(async () => undefined);
        const items = createProjectItemIndex([]);
        const itemDependencies = createItemDependencyIndex([], items);
        const session: ActionSyncContext = {
            canonicalizeItemName: (name) => items.canonicalizeObservedName(name),
            resolveItem: createItemFieldResolver(items, itemDependencies, "test-house"),
            trust: {
                housingUuid: "test-house",
                trustMode: true,
                importables: new Map(),
            },
            conflicts: [],
            events: undefined,
            itemRead: { mode: "sync" },
        };

        const result = await readActionListSync(null as unknown as TaskContext, {
            desired: desired.actions,
            basePath: "actions",
            sync: session,
            trustPlan: {
                importable: desired,
                identity: desired.name,
                entry,
                sourceHash: importableHash(desired),
                cacheHash: importableHash(cached),
                lockHash: importableHash(cached),
                lockListScanHashes: null,
                cacheMatchesLock: true,
                breakdown: {
                    dependenciesMatch: true,
                    itemBlobAvailable: true,
                    cacheMatchesLock: true,
                },
                trustMode: true,
                wholeImportableTrusted: false,
                trustedChildListPaths: new Set(),
                trustedChildLists: new Map(),
            },
            open,
        });

        expect(open).not.toHaveBeenCalled();
        expect(result.kind).toBe("planned");
        if (result.kind !== "planned") return;
        expect(result.plan.observed.map((slot) => slot.action)).toEqual(cached.actions);
        expect(result.plan.diff.operations).toHaveLength(1);
        expect(result.plan.phaseUnits.reading).toBe(0);
        expect(result.plan.phaseUnits.hydrating).toBe(0);

        const knownEmpty = await readActionListSync(null as unknown as TaskContext, {
            desired: desired.actions,
            basePath: "actions",
            sync: session,
            trustPlan: {
                importable: desired,
                identity: desired.name,
                entry,
                sourceHash: importableHash(desired),
                cacheHash: importableHash(cached),
                lockHash: importableHash(cached),
                lockListScanHashes: null,
                cacheMatchesLock: true,
                breakdown: {
                    dependenciesMatch: true,
                    itemBlobAvailable: true,
                    cacheMatchesLock: true,
                },
                trustMode: true,
                wholeImportableTrusted: false,
                trustedChildListPaths: new Set(["actions"]),
                trustedChildLists: new Map(),
            },
            current: { kind: "known-empty" },
            open,
        });

        expect(knownEmpty.kind).toBe("planned");
        if (knownEmpty.kind !== "planned") return;
        expect(knownEmpty.plan.observed).toEqual([]);
        expect(
            knownEmpty.plan.diff.operations.map((operation) => operation.kind)
        ).toEqual(["add"]);
    });
});
