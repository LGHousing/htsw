import { afterEach, describe, expect, it, vi } from "vitest";
import type { Action, ImportableFunction, ImportableItem } from "htsw/types";

import { acceptHouseLockAsCurrent } from "../src/importCache/acceptHouseLock";
import { importableHash } from "../src/importCache/hash";
import type TaskContext from "../src/tasks/context";
import type {
    ItemDependencyIndex,
    ItemDependencySnapshot,
} from "../src/importables/items/dependencyIndex";

function fn(name: string, message: string): ImportableFunction {
    const actions: Action[] = [{ type: "MESSAGE", message }];
    return { type: "FUNCTION", name, actions };
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("acceptHouseLockAsCurrent", () => {
    it("hydrates only source entries certified by the selected house lock", () => {
        const uuid = "accepted-lock-house";
        const importJsonPath = "./projects/demo/import.json";
        const accepted = fn("Accepted", "current");
        const changed = fn("Changed", "working tree");
        const undeclaredPath = `./htsw/.cache/${uuid}/function/HouseOnly.knowledge.json`;
        const changedPath = `./htsw/.cache/${uuid}/function/Changed.knowledge.json`;
        const lockPath = "./projects/demo/house.lock.json";
        const lockText = JSON.stringify({
            schemaVersion: 1,
            houseUuid: uuid,
            importables: {
                "FUNCTION:Accepted": {
                    type: "FUNCTION",
                    identity: "Accepted",
                    hash: importableHash(accepted),
                },
                "FUNCTION:Changed": {
                    type: "FUNCTION",
                    identity: "Changed",
                    hash: importableHash(fn("Changed", "locked")),
                },
            },
        });
        const files: Partial<Record<string, string>> = {
            [lockPath]: lockText,
            [undeclaredPath]: "house-only",
            [changedPath]: "older-local-knowledge",
        };
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files[path] !== undefined,
            read: (path: string) => files[path] ?? null,
            write: (path: string, content: string) => {
                if (path.indexOf(".tmp") >= 0) throw new Error("force fallback write");
                files[path] = content;
            },
        });
        const ctx = { displayMessage: vi.fn() } as unknown as TaskContext;

        const result = acceptHouseLockAsCurrent(ctx, importJsonPath, [accepted, changed]);

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.housingUuid).toBe(uuid);
        expect(result.accepted).toEqual([accepted]);
        expect(result.markedPresent).toBe(1);
        expect(result.skipped).toBe(0);
        expect(result.failed).toBe(0);
        expect(
            JSON.parse(files[`./htsw/.cache/${uuid}/function/Accepted.knowledge.json`]!)
        ).toMatchObject({
            writer: "project-lock",
            importable: accepted,
            hash: importableHash(accepted),
        });
        expect(JSON.parse(files[changedPath]!)).toMatchObject({
            schemaVersion: 2,
            name: "Changed",
            verified: false,
        });
        expect(JSON.parse(files[changedPath]!)).not.toHaveProperty("importable");
        expect(JSON.parse(files[changedPath]!)).not.toHaveProperty("writer");
        expect(files[undeclaredPath]).toBe("house-only");
        expect(files[lockPath]).toBe(lockText);
    });

    it("rejects an unbound lock without writing knowledge", () => {
        const importJsonPath = "./projects/demo/import.json";
        const files: Partial<Record<string, string>> = {
            "./projects/demo/house.lock.json": JSON.stringify({
                schemaVersion: 1,
                houseUuid: null,
                importables: {},
            }),
        };
        const write = vi.fn();
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files[path] !== undefined,
            read: (path: string) => files[path] ?? null,
            write,
        });

        const result = acceptHouseLockAsCurrent(
            { displayMessage: vi.fn() } as unknown as TaskContext,
            importJsonPath,
            [fn("Debug", "current")]
        );

        expect(result).toEqual({
            ok: false,
            reason: "unbound-lock",
        });
        expect(write).not.toHaveBeenCalled();
    });

    it("does not accept a lock whose referenced items have changed", () => {
        const uuid = "dependency-lock-house";
        const importJsonPath = "./projects/dependencies/import.json";
        const importable = fn("Uses Item", "same action");
        const lockedDependencies: ItemDependencySnapshot = {
            version: 1,
            dependencies: [
                {
                    target: { kind: "named", name: "Key" },
                    fingerprint: "0xold",
                },
            ],
        };
        const currentDependencies: ItemDependencySnapshot = {
            version: 1,
            dependencies: [
                {
                    target: { kind: "named", name: "Key" },
                    fingerprint: "0xnew",
                },
            ],
        };
        const files: Partial<Record<string, string>> = {
            "./projects/dependencies/house.lock.json": JSON.stringify({
                schemaVersion: 1,
                houseUuid: uuid,
                importables: {
                    "FUNCTION:Uses Item": {
                        type: "FUNCTION",
                        identity: "Uses Item",
                        hash: importableHash(importable),
                        itemDependencies: lockedDependencies,
                    },
                },
            }),
        };
        const write = vi.fn();
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files[path] !== undefined,
            read: (path: string) => files[path] ?? null,
            write,
        });
        const itemDependencies = {
            snapshotOf: () => currentDependencies,
        } as unknown as ItemDependencyIndex;

        const result = acceptHouseLockAsCurrent(
            { displayMessage: vi.fn() } as unknown as TaskContext,
            importJsonPath,
            [importable],
            itemDependencies
        );

        expect(result).toMatchObject({
            ok: true,
            accepted: [],
            markedPresent: 1,
            skipped: 0,
        });
        expect(write).toHaveBeenCalled();
    });

    it("only accepts action-bearing item knowledge when its interaction blob exists", () => {
        const uuid = "item-lock-house";
        const importJsonPath = "./projects/items/import.json";
        const missing: ImportableItem = {
            type: "ITEM",
            name: "Missing Blob",
            nbt: { type: "compound", value: {} },
            rightClickActions: [{ type: "MESSAGE", message: "missing" }],
        };
        const cached: ImportableItem = {
            type: "ITEM",
            name: "Cached Blob",
            nbt: { type: "compound", value: {} },
            rightClickActions: [{ type: "MESSAGE", message: "cached" }],
        };
        const emptyDependencies: ItemDependencySnapshot = {
            version: 1,
            dependencies: [],
        };
        const files: Partial<Record<string, string>> = {
            "./projects/items/house.lock.json": JSON.stringify({
                schemaVersion: 1,
                houseUuid: uuid,
                importables: {
                    "ITEM:Missing Blob": {
                        type: "ITEM",
                        identity: "Missing Blob",
                        hash: importableHash(missing),
                        itemDependencies: emptyDependencies,
                    },
                    "ITEM:Cached Blob": {
                        type: "ITEM",
                        identity: "Cached Blob",
                        hash: importableHash(cached),
                        itemDependencies: emptyDependencies,
                    },
                },
            }),
            [`./htsw/.cache/${uuid}/interact_data/v2-Cached Blob.snbt`]:
                '{version:3,right:"blob"}',
        };
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files[path] !== undefined,
            read: (path: string) => files[path] ?? null,
            write: (path: string, content: string) => {
                if (path.indexOf(".tmp") >= 0) throw new Error("force fallback write");
                files[path] = content;
            },
        });
        const itemDependencies = {
            snapshotOf: () => emptyDependencies,
            clickActionsFingerprint: (item: ImportableItem) => `v2-${item.name}`,
        } as unknown as ItemDependencyIndex;

        const result = acceptHouseLockAsCurrent(
            { displayMessage: vi.fn() } as unknown as TaskContext,
            importJsonPath,
            [missing, cached],
            itemDependencies
        );

        expect(result).toMatchObject({
            ok: true,
            accepted: [cached],
            markedPresent: 1,
            skipped: 0,
            failed: 0,
        });
        expect(
            files[`./htsw/.cache/${uuid}/item/Missing_0020Blob.knowledge.json`]
        ).toBeDefined();
        expect(
            JSON.parse(
                files[`./htsw/.cache/${uuid}/item/Cached_0020Blob.knowledge.json`]!
            )
        ).toMatchObject({ importable: cached, writer: "project-lock" });
    });

    it("does not write knowledge for a project importable absent from the lock", () => {
        const uuid = "missing-entry-house";
        const importJsonPath = "./projects/missing/import.json";
        const importable = fn("Not Locked", "current");
        const cachePath = `./htsw/.cache/${uuid}/function/Not_0020Locked.knowledge.json`;
        const files: Partial<Record<string, string>> = {
            "./projects/missing/house.lock.json": JSON.stringify({
                schemaVersion: 1,
                houseUuid: uuid,
                importables: {},
            }),
        };
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files[path] !== undefined,
            read: (path: string) => files[path] ?? null,
            write: (path: string, content: string) => {
                files[path] = content;
            },
        });

        const result = acceptHouseLockAsCurrent(
            { displayMessage: vi.fn() } as unknown as TaskContext,
            importJsonPath,
            [importable]
        );

        expect(result).toMatchObject({
            ok: true,
            accepted: [],
            markedPresent: 0,
            skipped: 1,
            failed: 0,
        });
        expect(files[cachePath]).toBeUndefined();
    });

    it("keeps verified knowledge unchanged when recording locked presence", () => {
        const uuid = "verified-entry-house";
        const importJsonPath = "./projects/verified/import.json";
        const importable = fn("Verified", "working tree");
        const cachePath = `./htsw/.cache/${uuid}/function/Verified.knowledge.json`;
        const verified = JSON.stringify({
            schemaVersion: 2,
            version: 1,
            writtenAt: "2026-07-29T00:00:00.000Z",
            name: "Verified",
            verified: true,
            writer: "reader",
            importable: fn("Verified", "house"),
            hash: "existing-hash",
            lists: { actions: ["existing-list-hash"] },
        });
        const files: Partial<Record<string, string>> = {
            "./projects/verified/house.lock.json": JSON.stringify({
                schemaVersion: 1,
                houseUuid: uuid,
                importables: {
                    "FUNCTION:Verified": {
                        type: "FUNCTION",
                        identity: "Verified",
                        hash: importableHash(fn("Verified", "locked")),
                    },
                },
            }),
            [cachePath]: verified,
        };
        vi.stubGlobal("FileLib", {
            exists: (path: string) => files[path] !== undefined,
            read: (path: string) => files[path] ?? null,
            write: (path: string, content: string) => {
                files[path] = content;
            },
        });
        vi.stubGlobal("Java", {
            type: (name: string) => {
                if (name === "java.nio.file.Paths") {
                    return { get: (path: string) => path };
                }
                if (name === "java.nio.file.Files") {
                    return {
                        exists: (path: string) =>
                            path === `./htsw/.cache/${uuid}/function`,
                        isDirectory: () => true,
                        newDirectoryStream: () => ({
                            iterator: () => {
                                let hasNext = true;
                                return {
                                    hasNext: () => hasNext,
                                    next: () => {
                                        hasNext = false;
                                        return {
                                            getFileName: () => ({
                                                toString: () =>
                                                    "Verified.knowledge.json",
                                            }),
                                        };
                                    },
                                };
                            },
                            close: () => undefined,
                        }),
                    };
                }
                throw new Error(`Unexpected Java type: ${name}`);
            },
        });

        const result = acceptHouseLockAsCurrent(
            { displayMessage: vi.fn() } as unknown as TaskContext,
            importJsonPath,
            [importable]
        );

        expect(result).toMatchObject({
            ok: true,
            accepted: [],
            markedPresent: 0,
            skipped: 1,
            failed: 0,
        });
        expect(files[cachePath]).toBe(verified);
    });
});
