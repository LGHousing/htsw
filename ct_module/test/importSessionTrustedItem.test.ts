import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportableItem } from "htsw/types";

const mocks = vi.hoisted(() => ({
    scanImportable: vi.fn(),
    tryWriteImportableCache: vi.fn(async () => true),
    deleteImportableCache: vi.fn(() => true),
    removeHouseLockImportables: vi.fn(() => true),
    upsertHouseLockImportablesOffThread: vi.fn(async () => true),
    placeItem: vi.fn(async () => undefined),
}));

vi.mock("../src/importables/import/importers", () => ({
    scanImportable: mocks.scanImportable,
}));

vi.mock("../src/housingSync/items/heldItem", () => ({
    createImportedItemPlacementSession: () => ({
        place: mocks.placeItem,
        restore: async () => undefined,
    }),
}));

vi.mock("../src/importCache", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/importCache")>()),
    buildTrustPlan: (
        housingUuid: string,
        importables: readonly ImportableItem[],
        trustMode: boolean
    ) => ({
        housingUuid,
        trustMode,
        importables: new Map(
            importables.map((importable) => [
                `${importable.type}:${importable.name}`,
                {
                    importable,
                    identity: importable.name,
                    entry: { importable, hash: "same", lists: {} },
                    sourceHash: "same",
                    cacheHash: "same",
                    lockHash: "same",
                    lockListScanHashes: null,
                    lockListContentHashes: null,
                    cacheMatchesLock: true,
                    trustMode: true,
                    wholeImportableTrusted: true,
                    trustedChildListPaths: new Set(),
                    trustedChildLists: new Map(),
                },
            ])
        ),
    }),
    deleteImportableCache: mocks.deleteImportableCache,
    tryWriteImportableCache: mocks.tryWriteImportableCache,
}));

vi.mock("../src/importCache/houseLock", () => ({
    removeHouseLockImportables: mocks.removeHouseLockImportables,
    upsertHouseLockImportablesOffThread: mocks.upsertHouseLockImportablesOffThread,
}));

import { runImportSession } from "../src/importables/import/session";
import type { SyncEvent } from "../src/housingSync/syncEvents";
import type TaskContext from "../src/tasks/context";

describe("trusted item rows", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("skips a whole-trusted ITEM without placing it in the hotbar", async () => {
        const item: ImportableItem = {
            type: "ITEM",
            name: "Sugar",
            nbt: {
                type: "compound",
                value: { id: { type: "string", value: "minecraft:sugar" } },
            } as never,
        };
        const events: SyncEvent[] = [];
        const ctx = {
            sleep: async () => undefined,
            displayMessage: () => undefined,
        } as unknown as TaskContext;

        await runImportSession(ctx, {
            importables: [item],
            trustMode: true,
            housingUuid: "test-house",
            sourcePath: "./project/import.json",
            parsed: { value: [item] } as never,
            events: { emit: (event) => events.push(event) },
            conflictHandling: { kind: "prompt", decide: async () => "cancel" },
        });

        expect(mocks.scanImportable).not.toHaveBeenCalled();
        expect(mocks.placeItem).not.toHaveBeenCalled();
        expect(mocks.tryWriteImportableCache).toHaveBeenCalledOnce();
        const finished = events.find((event) => event.kind === "importableFinished");
        expect(finished).toMatchObject({ status: "skipped" });
    });
});
