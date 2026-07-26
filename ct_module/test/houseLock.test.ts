import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportableFunction } from "htsw/types";

import {
    readHouseLock,
    upsertHouseLockImportable,
    type HouseLock,
} from "../src/importCache/houseLock";
import {
    ACTION_LIST_CONTENT_HASH_VERSION,
    ACTION_LIST_SCAN_HASH_VERSION,
    actionListContentHashFromActions,
    actionListScanHashFromActions,
} from "../src/housingSync/actions/scanHash";
import type { ItemDependencySnapshot } from "../src/importables/items/dependencyIndex";

const importJsonPath = "./projects/demo/import.json";
const lockPath = "./projects/demo/house.lock.json";

function functionEntry(): ImportableFunction {
    return {
        type: "FUNCTION",
        name: "Debug",
        actions: [{ type: "MESSAGE", message: "hello" }],
    };
}

function stubFiles(files: Partial<Record<string, string>>): void {
    vi.stubGlobal("FileLib", {
        exists: (path: string) => files[path] !== undefined,
        read: (path: string) => files[path] ?? null,
        write: (path: string, content: string) => {
            files[path] = content;
        },
    });
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("house lock scan hashes", () => {
    it("parses an old-format lock without new fields", () => {
        const files = {
            [lockPath]: JSON.stringify({
                schemaVersion: 1,
                houseUuid: "old-house",
                importables: {
                    "FUNCTION:Debug": {
                        type: "FUNCTION",
                        identity: "Debug",
                        hash: "0xold",
                    },
                },
            }),
        };
        stubFiles(files);

        expect(readHouseLock(importJsonPath)).toEqual({
            schemaVersion: 1,
            houseUuid: "old-house",
            importables: {
                "FUNCTION:Debug": {
                    type: "FUNCTION",
                    identity: "Debug",
                    hash: "0xold",
                },
            },
        });
    });

    it("writes and reads current scan hashes", () => {
        const files: Partial<Record<string, string>> = {};
        stubFiles(files);
        const importable = functionEntry();
        const itemDependencies: ItemDependencySnapshot = {
            version: 1,
            dependencies: [
                {
                    target: { kind: "named", name: "Key" },
                    fingerprint: "0x123",
                },
            ],
        };

        expect(
            upsertHouseLockImportable(
                importJsonPath,
                "current-house",
                importable,
                itemDependencies
            )
        ).toBe(true);
        const written = JSON.parse(files[lockPath]!) as HouseLock;
        expect(written.scanHashVersion).toBe(ACTION_LIST_SCAN_HASH_VERSION);
        expect(written.contentHashVersion).toBe(ACTION_LIST_CONTENT_HASH_VERSION);
        expect(written.importables["FUNCTION:Debug"].listScanHashes).toEqual({
            actions: actionListScanHashFromActions(importable.actions ?? []),
        });
        expect(written.importables["FUNCTION:Debug"].listContentHashes).toEqual({
            actions: actionListContentHashFromActions(importable.actions ?? []),
        });
        expect(written.importables["FUNCTION:Debug"].itemDependencies).toEqual(
            itemDependencies
        );
        expect(readHouseLock(importJsonPath)).toEqual(written);
    });

    it("hides entry scan hashes from a different scan-hash version", () => {
        const files = {
            [lockPath]: JSON.stringify({
                schemaVersion: 1,
                houseUuid: "future-house",
                scanHashVersion: ACTION_LIST_SCAN_HASH_VERSION + 1,
                importables: {
                    "FUNCTION:Debug": {
                        type: "FUNCTION",
                        identity: "Debug",
                        hash: "0xfuture",
                        listScanHashes: { actions: "0xfuture-scan" },
                    },
                },
            }),
        };
        stubFiles(files);

        expect(readHouseLock(importJsonPath)).toEqual({
            schemaVersion: 1,
            houseUuid: "future-house",
            scanHashVersion: ACTION_LIST_SCAN_HASH_VERSION + 1,
            importables: {
                "FUNCTION:Debug": {
                    type: "FUNCTION",
                    identity: "Debug",
                    hash: "0xfuture",
                },
            },
        });
    });

    it("hides entry content hashes from a different content-hash version", () => {
        const files = {
            [lockPath]: JSON.stringify({
                schemaVersion: 1,
                houseUuid: "future-house",
                contentHashVersion: ACTION_LIST_CONTENT_HASH_VERSION + 1,
                importables: {
                    "FUNCTION:Debug": {
                        type: "FUNCTION",
                        identity: "Debug",
                        hash: "0xfuture",
                        listContentHashes: { actions: "0xfuture-content" },
                    },
                },
            }),
        };
        stubFiles(files);

        expect(readHouseLock(importJsonPath)).toEqual({
            schemaVersion: 1,
            houseUuid: "future-house",
            contentHashVersion: ACTION_LIST_CONTENT_HASH_VERSION + 1,
            importables: {
                "FUNCTION:Debug": {
                    type: "FUNCTION",
                    identity: "Debug",
                    hash: "0xfuture",
                },
            },
        });
    });
});
