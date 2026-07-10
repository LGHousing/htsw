import { afterEach, describe, expect, it, vi } from "vitest";
import type {
    Action,
    ImportableCommand,
    ImportableFunction,
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
import { prepareActionListSync } from "../src/housingSync/actions/prepareSync";
import { createItemRegistry } from "../src/importables/itemRegistry";
import { createNpcLookupCache } from "../src/importables/npcs/listNpcs";
import type { ImportSession } from "../src/importables/imports";
import type TaskContext from "../src/tasks/context";

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
        const trustedChildListPaths = trustedChildListPathsForImportable(desired, listHashes(cached));

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
    it("disables trust for an importable when the local cache does not match the project lock", () => {
        const uuid = "lock-test-mismatch";
        const importJsonPath = "./projects/demo/import.json";
        const cached = fn([chat("cached")]);
        const desired = fn([chat("cached")]);
        const entry = cacheEntry(cached);
        const files: Record<string, string> = {
            [`./htsw/.cache/${uuid}/function/Debug.knowledge.json`]: JSON.stringify(entry),
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
    });

    it("keeps trust available when the local cache matches the project lock", () => {
        const uuid = "lock-test-match";
        const importJsonPath = "./projects/demo/import.json";
        const cached = fn([chat("same")]);
        const entry = cacheEntry(cached);
        const files: Record<string, string> = {
            [`./htsw/.cache/${uuid}/function/Debug.knowledge.json`]: JSON.stringify(entry),
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
    });
});

describe("trusted action-list planning", () => {
    it("plans a changed list from the lock-validated cache without opening Housing", async () => {
        const cached = fn([chat("old")]);
        const desired = fn([chat("new")]);
        const entry = cacheEntry(cached);
        const open = vi.fn(async () => undefined);
        const session: ImportSession = {
            parsed: { value: [] } as never,
            items: createItemRegistry([]),
            housingUuid: "test-house",
            trust: { housingUuid: "test-house", importables: new Map() },
            events: undefined,
            npcLookup: createNpcLookupCache(),
        };

        const result = await prepareActionListSync(null as unknown as TaskContext, {
            desired: desired.actions,
            basePath: "actions",
            session,
            trustPlan: {
                importable: desired,
                identity: desired.name,
                entry,
                sourceHash: importableHash(desired),
                cacheHash: importableHash(cached),
                lockHash: importableHash(cached),
                cacheMatchesLock: true,
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
    });
});
