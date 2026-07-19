import { afterEach, describe, expect, it, vi } from "vitest";
import type { Action, ImportableFunction } from "htsw/types";

import { acceptHouseLockAsCurrent } from "../src/importCache/acceptHouseLock";
import { importableHash } from "../src/importCache/hash";
import type TaskContext from "../src/tasks/context";
import type {
    ItemDependencyIndex,
    ItemDependencySnapshot,
} from "../src/importables/itemDependencyIndex";

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
        const files: Record<string, string> = {
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

        const result = acceptHouseLockAsCurrent(
            ctx,
            importJsonPath,
            [accepted, changed]
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.housingUuid).toBe(uuid);
        expect(result.accepted).toEqual([accepted]);
        expect(result.skipped).toBe(1);
        expect(result.failed).toBe(0);
        expect(JSON.parse(files[`./htsw/.cache/${uuid}/function/Accepted.knowledge.json`])).toMatchObject({
            writer: "project-lock",
            importable: accepted,
            hash: importableHash(accepted),
        });
        expect(files[changedPath]).toBe("older-local-knowledge");
        expect(files[undeclaredPath]).toBe("house-only");
        expect(files[lockPath]).toBe(lockText);
    });

    it("rejects an unbound lock without writing knowledge", () => {
        const importJsonPath = "./projects/demo/import.json";
        const files: Record<string, string> = {
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
        const files: Record<string, string> = {
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

        expect(result).toMatchObject({ ok: true, accepted: [], skipped: 1 });
        expect(write).not.toHaveBeenCalled();
    });
});
