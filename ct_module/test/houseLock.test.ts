import { afterEach, describe, expect, it, vi } from "vitest";
import type { ImportableFunction } from "htsw/types";

import {
    readHouseLock,
    recordedRevertDate,
    seedMissingHouseLockActionLists,
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
        expect(written.contentHashJournalVersion).toBe(1);
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

    it("keeps only the last three distinct list content hashes", () => {
        const files: Partial<Record<string, string>> = {};
        stubFiles(files);
        for (const message of ["one", "two", "three", "four"]) {
            const importable = functionEntry();
            importable.actions![0] = { type: "MESSAGE", message };
            expect(
                upsertHouseLockImportable(importJsonPath, "current-house", importable)
            ).toBe(true);
        }

        const journal =
            readHouseLock(importJsonPath)?.importables["FUNCTION:Debug"]
                .listContentHashJournal?.actions;
        expect(journal?.map((entry) => entry.hash)).toEqual(
            ["two", "three", "four"].map((message) =>
                actionListContentHashFromActions([{ type: "MESSAGE", message }])
            )
        );
        expect(
            journal?.every((entry) => !Number.isNaN(Date.parse(entry.recordedAt)))
        ).toBe(true);
    });

    it("rejects writes to an unknown journal version without changing the file", () => {
        const futureLock = JSON.stringify({
            schemaVersion: 1,
            houseUuid: "current-house",
            contentHashJournalVersion: 2,
            importables: {
                "FUNCTION:Debug": {
                    type: "FUNCTION",
                    identity: "Debug",
                    hash: "0xfuture",
                    listContentHashJournal: {
                        actions: [
                            {
                                hash: "0xfuture-content",
                                recordedAt: "2026-07-28T00:00:00.000Z",
                                futureField: "preserve me",
                            },
                        ],
                    },
                },
            },
        });
        const files = { [lockPath]: futureLock };
        stubFiles(files);
        const importable = functionEntry();

        expect(
            upsertHouseLockImportable(importJsonPath, "current-house", importable)
        ).toBe(false);
        expect(
            seedMissingHouseLockActionLists(importJsonPath, "current-house", [
                {
                    importable,
                    basePath: "actions",
                    actions: importable.actions!,
                },
            ])
        ).toBe(false);
        expect(files[lockPath]).toBe(futureLock);
    });

    it("starts journal history with the existing content baseline on upgrade", () => {
        const baseline = [messageAction("baseline")];
        const baselineHash = actionListContentHashFromActions(baseline);
        const files: Partial<Record<string, string>> = {
            [lockPath]: JSON.stringify({
                schemaVersion: 1,
                houseUuid: "current-house",
                contentHashVersion: ACTION_LIST_CONTENT_HASH_VERSION,
                importables: {
                    "FUNCTION:Debug": {
                        type: "FUNCTION",
                        identity: "Debug",
                        hash: "0xold",
                        listContentHashes: { actions: baselineHash },
                    },
                },
            }),
        };
        stubFiles(files);
        const newer = functionEntry();
        newer.actions = [messageAction("newer")];
        const newerHash = actionListContentHashFromActions(newer.actions);

        expect(
            upsertHouseLockImportable(importJsonPath, "current-house", newer)
        ).toBe(true);
        const journal =
            readHouseLock(importJsonPath)?.importables["FUNCTION:Debug"]
                .listContentHashJournal?.actions;
        expect(journal?.map((entry) => entry.hash)).toEqual([
            baselineHash,
            newerHash,
        ]);
        expect(recordedRevertDate(journal, baselineHash, newerHash)).toEqual(
            expect.any(String)
        );
    });

    it("seeds a missing live baseline without replacing an existing one", () => {
        const existing = [functionEntry().actions![0]];
        const files: Partial<Record<string, string>> = {
            [lockPath]: JSON.stringify({
                schemaVersion: 1,
                houseUuid: "current-house",
                scanHashVersion: ACTION_LIST_SCAN_HASH_VERSION,
                contentHashVersion: ACTION_LIST_CONTENT_HASH_VERSION,
                importables: {
                    "FUNCTION:Debug": {
                        type: "FUNCTION",
                        identity: "Debug",
                        hash: "existing-importable",
                        listScanHashes: {
                            actions: actionListScanHashFromActions(existing),
                        },
                        listContentHashes: {
                            actions: actionListContentHashFromActions(existing),
                        },
                    },
                },
            }),
        };
        stubFiles(files);
        const live = [{ type: "MESSAGE", message: "live" }] as const;

        expect(
            seedMissingHouseLockActionLists(importJsonPath, "current-house", [
                { importable: functionEntry(), basePath: "actions", actions: live },
            ])
        ).toBe(true);
        expect(JSON.parse(files[lockPath]!)).toMatchObject({
            importables: {
                "FUNCTION:Debug": {
                    hash: "existing-importable",
                    listScanHashes: {
                        actions: actionListScanHashFromActions(existing),
                    },
                    listContentHashes: {
                        actions: actionListContentHashFromActions(existing),
                    },
                },
            },
        });
        expect(
            readHouseLock(importJsonPath)?.importables["FUNCTION:Debug"]
                .listContentHashJournal?.actions.map((entry) => entry.hash)
        ).toEqual([actionListContentHashFromActions(existing)]);
    });

    it("seeds the observed live state when no baseline exists", () => {
        const files: Partial<Record<string, string>> = {};
        stubFiles(files);
        const live = functionEntry();

        expect(
            seedMissingHouseLockActionLists(importJsonPath, "current-house", [
                { importable: live, basePath: "actions", actions: live.actions! },
            ])
        ).toBe(true);
        expect(readHouseLock(importJsonPath)).toMatchObject({
            houseUuid: "current-house",
            importables: {
                "FUNCTION:Debug": {
                    listScanHashes: {
                        actions: actionListScanHashFromActions(live.actions!),
                    },
                    listContentHashes: {
                        actions: actionListContentHashFromActions(live.actions!),
                    },
                },
            },
        });
        const journal =
            readHouseLock(importJsonPath)?.importables["FUNCTION:Debug"]
                .listContentHashJournal?.actions;
        expect(journal?.map((entry) => entry.hash)).toEqual([
            actionListContentHashFromActions(live.actions!),
        ]);
        expect(typeof journal?.[0].recordedAt).toBe("string");
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

function messageAction(message: string): NonNullable<ImportableFunction["actions"]>[number] {
    return { type: "MESSAGE", message };
}
