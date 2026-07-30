import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, ImportableFunction } from "htsw/types";

const mocks = vi.hoisted(() => ({
    applyImportablePlan: vi.fn(async () => undefined),
    scanImportable: vi.fn(),
    hydrateImportable: vi.fn(async () => undefined),
    tryWriteImportableCache: vi.fn(async () => true),
    deleteImportableCache: vi.fn(() => true),
    upsertHouseLockImportables: vi.fn(
        (_path: string, _housingUuid: string, _updates: unknown[]) => true
    ),
}));

vi.mock("../src/importables/import/importers", () => ({
    scanImportable: mocks.scanImportable,
}));

vi.mock("../src/importCache", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/importCache")>()),
    buildTrustPlan: (
        housingUuid: string,
        importables: readonly ImportableFunction[],
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
                    entry: null,
                    sourceHash: "",
                    cacheHash: null,
                    lockHash: null,
                    lockListScanHashes: { actions: "baseline" },
                    lockListContentHashes: { actions: "baseline-content" },
                    cacheMatchesLock: true,
                    trustMode: false,
                    wholeImportableTrusted: false,
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
    upsertHouseLockImportables: mocks.upsertHouseLockImportables,
}));

vi.mock("../src/runtimeDebug/importFailureLog", () => ({
    writeImportFailureLog: () => "./failure.log",
}));

import {
    runImportSession,
    type ImportSessionRequest,
} from "../src/importables/import/session";
import type { SyncEvent } from "../src/housingSync/syncEvents";
import { createTaskCancelledError } from "../src/tasks/cancellation";
import type TaskContext from "../src/tasks/context";
import { message } from "./utils";
import { conflictAwaitingConfirmationMessage } from "../src/importables/import/conflictChat";
import { canonicalItemShellTagKey } from "../src/housingSync/items/itemNbt";
import type { TagLike } from "../src/housingSync/items/itemTag";

// @ts-expect-error Every import caller must choose conflict handling.
const requestWithoutConflictHandling: ImportSessionRequest = {
    importables: [],
    trustMode: false,
    housingUuid: "test-house",
    sourcePath: "./project/import.json",
};
void requestWithoutConflictHandling;

const cacheApplicationPlan = {
    steps: [{ key: "cache", kind: "work", units: 0.25 }] as const,
    totalUnits: 0.25,
};

describe("import conflict gate", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.applyImportablePlan.mockResolvedValue(undefined);
        mocks.hydrateImportable.mockResolvedValue(undefined);
        mocks.tryWriteImportableCache.mockResolvedValue(true);
        mocks.deleteImportableCache.mockReturnValue(true);
        mocks.upsertHouseLockImportables.mockReturnValue(true);
    });

    it("skips every planned row and leaves caches and the lock untouched on cancel", async () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: [message("desired")],
        };
        mocks.scanImportable.mockImplementation(
            async (
                _ctx: unknown,
                _importable: unknown,
                session: { actions: { conflicts: unknown[] } }
            ) => {
                session.actions.conflicts.push({
                    type: "FUNCTION",
                    identity: "Debug",
                    basePath: "actions",
                });
                return {
                    kind: "FUNCTION",
                    importable,
                    needsHydration: true,
                    hydrate: mocks.hydrateImportable,
                    plan: () => ({
                        kind: "FUNCTION",
                        importable,
                        applicationPlan: cacheApplicationPlan,
                        applicationUnits: cacheApplicationPlan.totalUnits,
                        isNoOp: () => false,
                        apply: mocks.applyImportablePlan,
                        reconstructObserved: () => null,
                        reconstructPartial: () => null,
                    }),
                };
            }
        );
        const events: SyncEvent[] = [];
        const messages: string[] = [];
        const ctx = {
            sleep: async () => undefined,
            displayMessage: (text: string) => messages.push(text),
        } as unknown as TaskContext;

        await runImportSession(ctx, {
            importables: [importable],
            trustMode: true,
            housingUuid: "test-house",
            sourcePath: "./project/import.json",
            parsed: { value: [importable] } as never,
            events: { emit: (event) => events.push(event) },
            conflictHandling: {
                kind: "prompt",
                decide: async () => false,
            },
        });

        expect(mocks.applyImportablePlan).not.toHaveBeenCalled();
        expect(mocks.tryWriteImportableCache).not.toHaveBeenCalled();
        expect(mocks.upsertHouseLockImportables).not.toHaveBeenCalled();
        expect(events).toContainEqual({
            kind: "importableFinished",
            key: "./project/import.json|FUNCTION:Debug",
            status: "skipped",
        });
        expect(events[events.length - 1]).toEqual({ kind: "sessionFinished" });
        expect(messages).toContain(
            "&c[htsw] Import cancelled — Housing changed since the last import."
        );
    });

    it("saves completed observations when hydration is cancelled", async () => {
        const importables: ImportableFunction[] = [
            { type: "FUNCTION", name: "First", actions: [message("first")] },
            { type: "FUNCTION", name: "Second", actions: [message("second")] },
        ];
        mocks.scanImportable.mockImplementation(
            async (_ctx: unknown, importable: ImportableFunction) => ({
                kind: "FUNCTION",
                importable,
                needsHydration: true,
                hydrate:
                    importable.name === "Second"
                        ? async () => {
                              throw createTaskCancelledError();
                          }
                        : mocks.hydrateImportable,
                plan: () => ({
                    kind: "FUNCTION",
                    importable,
                    applicationPlan: cacheApplicationPlan,
                    applicationUnits: cacheApplicationPlan.totalUnits,
                    isNoOp: () => false,
                    apply: mocks.applyImportablePlan,
                    reconstructObserved: () => importable,
                    reconstructPartial: () => null,
                }),
            })
        );
        const messages: string[] = [];
        const ctx = {
            sleep: async () => undefined,
            displayMessage: (text: string) => messages.push(text),
        } as unknown as TaskContext;

        await expect(
            runImportSession(ctx, {
                importables,
                trustMode: false,
                housingUuid: "test-house",
                sourcePath: "./project/import.json",
                parsed: { value: importables } as never,
                conflictHandling: { kind: "proceed" },
            })
        ).rejects.toMatchObject({ __taskCancelled: true });

        expect(mocks.tryWriteImportableCache).toHaveBeenCalledTimes(1);
        expect(mocks.tryWriteImportableCache).toHaveBeenCalledWith(
            ctx,
            importables[0],
            "importer",
            "test-house",
            { itemDependencies: { version: 1, dependencies: [] } }
        );
        expect(mocks.upsertHouseLockImportables).toHaveBeenCalledTimes(1);
        expect(messages).toContain(
            "&a[htsw] Cancellation saved verified house state for &f1&a importable; retry can reuse the cache."
        );
    });

    it("persists hydrated chunks when a later scan fails", async () => {
        const importables: ImportableFunction[] = Array.from(
            { length: 26 },
            (_, index) => ({
                type: "FUNCTION",
                name: `Function ${index + 1}`,
                actions: [message(`${index + 1}`)],
            })
        );
        mocks.scanImportable.mockImplementation(
            async (_ctx: unknown, importable: ImportableFunction) => {
                if (importable.name === "Function 26") throw new Error("scan failed");
                return {
                    kind: "FUNCTION",
                    importable,
                    needsHydration: true,
                    hydrate: mocks.hydrateImportable,
                    plan: () => ({
                        kind: "FUNCTION",
                        importable,
                        applicationPlan: cacheApplicationPlan,
                        applicationUnits: cacheApplicationPlan.totalUnits,
                        isNoOp: () => false,
                        apply: mocks.applyImportablePlan,
                        reconstructObserved: () => importable,
                        reconstructPartial: () => null,
                    }),
                };
            }
        );
        const messages: string[] = [];
        const ctx = {
            sleep: async () => undefined,
            displayMessage: (text: string) => messages.push(text),
        } as unknown as TaskContext;

        await runImportSession(ctx, {
            importables,
            trustMode: false,
            housingUuid: "test-house",
            sourcePath: "./project/import.json",
            parsed: { value: importables } as never,
            conflictHandling: { kind: "proceed" },
        });

        expect(mocks.hydrateImportable).toHaveBeenCalledTimes(25);
        expect(mocks.tryWriteImportableCache).toHaveBeenCalledTimes(25);
        expect(mocks.upsertHouseLockImportables).toHaveBeenCalledWith(
            "./project/import.json",
            "test-house",
            expect.arrayContaining([
                expect.objectContaining({ importable: importables[0] }),
                expect.objectContaining({ importable: importables[24] }),
            ])
        );
        expect(messages).toContain(
            "&7[htsw] Saved verified house state for 25 importables. Retry can reuse them."
        );
    });

    it("saves a safe partial state and flushes the lock when apply is cancelled", async () => {
        const importables: ImportableFunction[] = [
            { type: "FUNCTION", name: "First", actions: [message("first")] },
            { type: "FUNCTION", name: "Second", actions: [message("second")] },
        ];
        mocks.scanImportable.mockImplementation(
            async (_ctx: unknown, importable: ImportableFunction) => ({
                kind: "FUNCTION",
                importable,
                needsHydration: true,
                hydrate: mocks.hydrateImportable,
                plan: () => ({
                    kind: "FUNCTION",
                    importable,
                    applicationPlan: cacheApplicationPlan,
                    applicationUnits: cacheApplicationPlan.totalUnits,
                    isNoOp: () => false,
                    apply:
                        importable.name === "Second"
                            ? async () => {
                                  throw createTaskCancelledError();
                              }
                            : mocks.applyImportablePlan,
                    reconstructObserved: () => importable,
                    reconstructPartial: () => importable,
                }),
            })
        );
        const messages: string[] = [];
        const ctx = {
            sleep: async () => undefined,
            displayMessage: (text: string) => messages.push(text),
        } as unknown as TaskContext;

        await expect(
            runImportSession(ctx, {
                importables,
                trustMode: false,
                housingUuid: "test-house",
                sourcePath: "./project/import.json",
                parsed: { value: importables } as never,
                conflictHandling: { kind: "proceed" },
            })
        ).rejects.toMatchObject({ __taskCancelled: true });

        expect(mocks.upsertHouseLockImportables).toHaveBeenLastCalledWith(
            "./project/import.json",
            "test-house",
            expect.arrayContaining([
                expect.objectContaining({ importable: importables[0] }),
                expect.objectContaining({ importable: importables[1] }),
            ])
        );
        expect(messages).toContain(
            "&a[htsw] Cancellation saved verified house state for &f2&a importables; retry can reuse the cache."
        );
    });

    it("carries observed item content into a reconstructed cancellation lock", async () => {
        const desiredItem = {
            type: "GIVE_ITEM",
            itemName: "desired",
        } as Action;
        const partialItem = {
            type: "GIVE_ITEM",
            itemName: "observed",
        } as Action;
        const observedTag: TagLike = {
            type: "compound",
            value: { id: { type: "string", value: "minecraft:apple" } },
        };
        const observedKey = canonicalItemShellTagKey(observedTag);
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Partial",
            actions: [desiredItem],
        };
        const cancellation = createTaskCancelledError() as Error & {
            __htswActionListApplyResult?: {
                currentSnapshot: Action[];
                itemContent: (owner: Action, property: string) => string | undefined;
            };
        };
        cancellation.__htswActionListApplyResult = {
            currentSnapshot: [partialItem],
            itemContent: (owner, property) =>
                owner === partialItem && property === "itemName"
                    ? observedKey
                    : undefined,
        };
        mocks.scanImportable.mockResolvedValue({
            kind: "FUNCTION",
            importable,
            needsHydration: true,
            hydrate: mocks.hydrateImportable,
            plan: () => ({
                kind: "FUNCTION",
                importable,
                applicationPlan: cacheApplicationPlan,
                applicationUnits: cacheApplicationPlan.totalUnits,
                isNoOp: () => false,
                apply: async () => {
                    throw cancellation;
                },
                reconstructObserved: () => importable,
                reconstructPartial: (
                    result: {
                        currentSnapshot: Action[];
                    } | null
                ) =>
                    result === null
                        ? null
                        : {
                              type: "FUNCTION",
                              name: "Partial",
                              actions: result.currentSnapshot,
                          },
            }),
        });
        const ctx = {
            sleep: async () => undefined,
            displayMessage: () => undefined,
        } as unknown as TaskContext;

        await expect(
            runImportSession(ctx, {
                importables: [importable],
                trustMode: false,
                housingUuid: "test-house",
                sourcePath: "./project/import.json",
                parsed: { value: [importable] } as never,
                conflictHandling: { kind: "proceed" },
            })
        ).rejects.toMatchObject({ __taskCancelled: true });

        const lockCalls = mocks.upsertHouseLockImportables.mock.calls;
        const updates = lockCalls[lockCalls.length - 1][2] as Array<{
            importable: ImportableFunction;
            itemContent: (owner: Action, property: string) => string | undefined;
        }>;
        const update = updates.find((entry) => entry.importable.name === "Partial")!;
        const reconstructedItem = update.importable.actions![0];
        expect(update.itemContent(reconstructedItem, "itemName")).toBe(observedKey);
    });

    it("invalidates the current cache when cancellation leaves its state unverified", async () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Unsafe",
            actions: [message("unsafe")],
        };
        mocks.scanImportable.mockResolvedValue({
            kind: "FUNCTION",
            importable,
            needsHydration: true,
            hydrate: mocks.hydrateImportable,
            plan: () => ({
                kind: "FUNCTION",
                importable,
                applicationPlan: cacheApplicationPlan,
                applicationUnits: cacheApplicationPlan.totalUnits,
                isNoOp: () => false,
                apply: async () => {
                    throw createTaskCancelledError();
                },
                reconstructObserved: () => importable,
                reconstructPartial: () => null,
            }),
        });
        const messages: string[] = [];
        const ctx = {
            sleep: async () => undefined,
            displayMessage: (text: string) => messages.push(text),
        } as unknown as TaskContext;

        await expect(
            runImportSession(ctx, {
                importables: [importable],
                trustMode: false,
                housingUuid: "test-house",
                sourcePath: "./project/import.json",
                parsed: { value: [importable] } as never,
                conflictHandling: { kind: "proceed" },
            })
        ).rejects.toMatchObject({ __taskCancelled: true });

        expect(mocks.deleteImportableCache).toHaveBeenCalledWith(
            "test-house",
            "FUNCTION",
            "Unsafe"
        );
        expect(messages).toContain(
            "&7[htsw] Cancellation could not save a verified state for the current importable."
        );
        expect(messages).toContain(
            "&e[htsw] The current importable stopped during an unverified change, so its stale cache entry was removed."
        );
    });
});

describe("import conflict chat", () => {
    it("counts distinct importables rather than conflicting action lists", () => {
        expect(
            conflictAwaitingConfirmationMessage([
                { type: "ITEM", identity: "Wand", basePath: "leftClickActions" },
                { type: "ITEM", identity: "Wand", basePath: "rightClickActions" },
                { type: "FUNCTION", identity: "Debug", basePath: "actions" },
            ])
        ).toBe(
            "[htsw] Import conflict: 2 importables changed in Housing — awaiting confirmation\n" +
                '[htsw] Conflict: ITEM "Wand" · leftClickActions\n' +
                '[htsw] Conflict: ITEM "Wand" · rightClickActions\n' +
                '[htsw] Conflict: FUNCTION "Debug" · actions'
        );
    });
});
