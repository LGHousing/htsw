import { afterEach, describe, expect, it, vi } from "vitest";
import type { Action, ImportableFunction } from "htsw/types";

import {
    readHouseLock,
    upsertHouseLockImportable,
    upsertHouseLockImportables,
    type HouseLock,
} from "../src/importCache/houseLock";
import {
    ACTION_LIST_CONTENT_HASH_VERSION,
    ACTION_LIST_SCAN_HASH_VERSION,
    actionListContentHashFromActions,
    actionListScanHashFromActions,
} from "../src/housingSync/actions/scanHash";
import type { ItemDependencySnapshot } from "../src/importables/items/dependencyIndex";
import type { ItemFieldContent } from "../src/housingSync/items/fieldContent";
import { cloneActionsWithItemFieldContent } from "../src/housingSync/items/fieldContent";
import { canonicalItemShellTagKey } from "../src/housingSync/items/itemNbt";
import type { TagLike } from "../src/housingSync/items/itemTag";

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
                { importable, itemDependencies, itemContent: undefined }
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

    it("uses explicit item content for cached and reconstructed importables", () => {
        const files: Partial<Record<string, string>> = {};
        stubFiles(files);
        const cookie: TagLike = {
            type: "compound",
            value: { id: { type: "string", value: "minecraft:cookie" } },
        };
        const apple: TagLike = {
            type: "compound",
            value: { id: { type: "string", value: "minecraft:apple" } },
        };
        const cachedItem = { type: "GIVE_ITEM", itemName: "cached" } as Action;
        const reconstructedItem = {
            type: "GIVE_ITEM",
            itemName: "reconstructed",
        } as Action;
        const cached: ImportableFunction = {
            type: "FUNCTION",
            name: "Cached",
            actions: [cachedItem],
        };
        const reconstructed: ImportableFunction = {
            type: "FUNCTION",
            name: "Reconstructed",
            actions: [reconstructedItem],
        };
        const contentFor = (
            action: Action,
            tag: TagLike
        ): ItemFieldContent => (owner, property) =>
            owner === action && property === "itemName"
                ? { key: canonicalItemShellTagKey(tag), tag }
                : undefined;
        const cachedContent = contentFor(cachedItem, cookie);
        const reconstructedContent = contentFor(reconstructedItem, apple);

        expect(
            upsertHouseLockImportables(importJsonPath, "current-house", [
                { importable: cached, itemContent: cachedContent },
                {
                    importable: reconstructed,
                    itemContent: reconstructedContent,
                },
            ])
        ).toBe(true);

        const written = JSON.parse(files[lockPath]!) as HouseLock;
        expect(written.importables["FUNCTION:Cached"].listContentHashes).toEqual({
            actions: actionListContentHashFromActions(
                cached.actions ?? [],
                cachedContent
            ),
        });
        expect(
            written.importables["FUNCTION:Reconstructed"].listContentHashes
        ).toEqual({
            actions: actionListContentHashFromActions(
                reconstructed.actions ?? [],
                reconstructedContent
            ),
        });
    });

    it("preserves item content when an apply snapshot is cloned", () => {
        const tag: TagLike = {
            type: "compound",
            value: { id: { type: "string", value: "minecraft:cookie" } },
        };
        const action = { type: "GIVE_ITEM", itemName: "cookie" } as Action;
        const key = canonicalItemShellTagKey(tag);
        const cloned = cloneActionsWithItemFieldContent(
            [action],
            (owner, property) =>
                owner === action && property === "itemName"
                    ? { key, tag }
                    : undefined
        );
        const clonedAction = cloned.actions[0]!;

        expect(clonedAction).not.toBe(action);
        expect(cloned.itemContent?.(clonedAction, "itemName")?.key).toBe(key);
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
