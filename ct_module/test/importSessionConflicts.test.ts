import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, ImportableFunction, ImportableMenu } from "htsw/types";

const mocks = vi.hoisted(() => ({
    applyImportablePlan: vi.fn(async () => undefined),
    scanImportable: vi.fn(),
    hydrateImportable: vi.fn(async () => undefined),
    tryWriteImportableCache: vi.fn(async () => true),
    deleteImportableCache: vi.fn(() => true),
    removeHouseLockImportables: vi.fn(() => true),
    upsertHouseLockImportablesOffThread: vi.fn(
        async (_path: string, _housingUuid: string, _updates: unknown[]) => true
    ),
    writeDiffDetailsFile: vi.fn(() => "./project/htsw-diff/latest.diff"),
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
    removeHouseLockImportables: mocks.removeHouseLockImportables,
    upsertHouseLockImportablesOffThread: mocks.upsertHouseLockImportablesOffThread,
}));

vi.mock("../src/runtimeDebug/importFailureLog", () => ({
    writeTaskFailureLog: () => "./failure.log",
}));

vi.mock("../src/housingSync/actions/diffDetails", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/housingSync/actions/diffDetails")>()),
    writeDiffDetailsFile: mocks.writeDiffDetailsFile,
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
const _requestWithoutConflictHandling: ImportSessionRequest = {
    importables: [],
    trustMode: false,
    housingUuid: "test-house",
    sourcePath: "./project/import.json",
};

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
        mocks.upsertHouseLockImportablesOffThread.mockResolvedValue(true);
    });

    it("leaves planned rows unfinished and caches and the lock untouched on cancel", async () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: [message("desired")],
        };
        mocks.scanImportable.mockImplementation(
            async (
                _ctx: unknown,
                _importable: unknown,
                session: {
                    actions: {
                        conflicts: unknown[];
                        conflictEvidence: unknown[];
                    };
                }
            ) => {
                session.actions.conflicts.push({
                    type: "FUNCTION",
                    identity: "Debug",
                    basePath: "actions",
                });
                session.actions.conflictEvidence.push({
                    type: "FUNCTION",
                    identity: "Debug",
                    basePath: "actions",
                    liveActions: [message("live")],
                    sourceActions: importable.actions,
                    canonicalDifferences: [
                        {
                            path: "action 1 (message) · message",
                            live: '"live"',
                            source: '"desired"',
                        },
                    ],
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
                decide: async () => {
                    expect(
                        messages.some((message) =>
                            message.includes("Housing conflict detected — diff saved to")
                        )
                    ).toBe(true);
                    return "cancel";
                },
            },
        });

        expect(mocks.applyImportablePlan).not.toHaveBeenCalled();
        expect(mocks.tryWriteImportableCache).not.toHaveBeenCalled();
        expect(mocks.upsertHouseLockImportablesOffThread).not.toHaveBeenCalled();
        expect(events.some((event) => event.kind === "importableFinished")).toBe(false);
        expect(events[events.length - 1]).toEqual({ kind: "sessionFinished" });
        expect(messages).toContain(
            "&c[htsw] Import cancelled — Housing changed since the last import."
        );
    });

    it("retains the hydrated Housing snapshot for review without updating the lock", async () => {
        const desired: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: [message("desired")],
        };
        const observed: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: [message("observed")],
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
                    importable: desired,
                    needsHydration: true,
                    hydrate: mocks.hydrateImportable,
                    plan: () => ({
                        kind: "FUNCTION",
                        importable: desired,
                        applicationPlan: cacheApplicationPlan,
                        applicationUnits: cacheApplicationPlan.totalUnits,
                        isNoOp: () => false,
                        apply: mocks.applyImportablePlan,
                        reconstructObserved: () => observed,
                        reconstructPartial: () => null,
                    }),
                };
            }
        );
        const onReviewPrepared = vi.fn();
        const events: SyncEvent[] = [];
        const ctx = {
            sleep: async () => undefined,
            displayMessage: () => undefined,
        } as unknown as TaskContext;

        await runImportSession(ctx, {
            importables: [desired],
            trustMode: true,
            housingUuid: "test-house",
            sourcePath: "./project/import.json",
            parsed: { value: [desired] } as never,
            events: { emit: (event) => events.push(event) },
            conflictHandling: {
                kind: "prompt",
                decide: async () => "review",
                onReviewPrepared,
            },
        });

        expect(mocks.tryWriteImportableCache).toHaveBeenCalledTimes(1);
        expect(events.some((event) => event.kind === "importableFinished")).toBe(false);
        expect(mocks.tryWriteImportableCache).toHaveBeenCalledWith(
            ctx,
            observed,
            "importer",
            "test-house",
            {
                itemDependencies: { version: 1, dependencies: [] },
            }
        );
        expect(mocks.upsertHouseLockImportablesOffThread).not.toHaveBeenCalled();
        expect(mocks.applyImportablePlan).not.toHaveBeenCalled();
        expect(onReviewPrepared).toHaveBeenCalledWith(["FUNCTION:Debug"]);
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
        expect(mocks.upsertHouseLockImportablesOffThread).toHaveBeenCalledTimes(1);
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
        expect(mocks.upsertHouseLockImportablesOffThread).toHaveBeenCalledWith(
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

    it("locks each applied importable as it finishes and saves a safe partial state on cancel", async () => {
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

        expect(mocks.upsertHouseLockImportablesOffThread).toHaveBeenCalledWith(
            "./project/import.json",
            "test-house",
            [expect.objectContaining({ importable: importables[0] })]
        );
        expect(mocks.upsertHouseLockImportablesOffThread).toHaveBeenLastCalledWith(
            "./project/import.json",
            "test-house",
            [expect.objectContaining({ importable: importables[1] })]
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

        const lockCalls = mocks.upsertHouseLockImportablesOffThread.mock.calls;
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
        expect(mocks.removeHouseLockImportables).toHaveBeenCalledWith(
            "./project/import.json",
            [{ type: "FUNCTION", identity: "Unsafe" }]
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

it("persists a menu cancellation snapshot as partial in both cache and lock", async () => {
    vi.clearAllMocks();
    const importable: ImportableMenu = {
        type: "MENU",
        name: "Partial",
        size: 1,
        slots: [
            {
                slot: 0,
                nbt: { type: "compound", value: {} },
                actions: [message("desired")],
            },
        ],
    };
    const partial: ImportableMenu = { ...importable, slots: [] };
    mocks.scanImportable.mockResolvedValue({
        kind: "MENU",
        importable,
        needsHydration: false,
        plan: () => ({
            kind: "MENU",
            importable,
            applicationPlan: cacheApplicationPlan,
            applicationUnits: cacheApplicationPlan.totalUnits,
            isNoOp: () => false,
            apply: async () => {
                throw createTaskCancelledError();
            },
            reconstructObserved: () => null,
            reconstructPartial: () => partial,
        }),
    });
    const ctx = {
        sleep: async () => undefined,
        displayMessage: vi.fn(),
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
    expect(mocks.tryWriteImportableCache).toHaveBeenCalledWith(
        ctx,
        partial,
        "importer",
        "test-house",
        expect.objectContaining({ partial: true })
    );
    expect(mocks.upsertHouseLockImportablesOffThread).toHaveBeenLastCalledWith(
        "./project/import.json",
        "test-house",
        [expect.objectContaining({ importable: partial, partial: true })]
    );
});

it("keeps the retry prefix first in the final FUNCTION reason when Add Action readiness times out", async () => {
    const { addAction } = await import("../src/housingSync/actions/apply/actionOps");
    const menuWait = await import("../src/housingSync/menus/menuWait");
    const menuUtils = await import("../src/housingSync/menus/menuUtils");
    const slots = await import("../src/tasks/specifics/slots");
    const click = vi.fn();
    // The picker opens; the real second readiness wait expires after selection.
    vi.spyOn(menuWait, "timedWaitForMenu").mockResolvedValueOnce(undefined);
    vi.spyOn(menuUtils, "getSlotPaginate").mockResolvedValue({
        getItem: () => ({ getLore: () => [] }),
        click,
    } as never);
    vi.spyOn(slots, "menuStateDescription").mockReturnValue(' in "Action Settings"');
    vi.spyOn(slots, "describeGuiScreenMenu").mockReturnValue("GuiChest");
    const importable: ImportableFunction = {
        type: "FUNCTION",
        name: "Readiness",
        actions: [message("new")],
    };
    const ctx = {
        sleep: async () => undefined,
        displayMessage: () => undefined,
        getMenuItemSlot: () => ({ click: () => undefined }),
        waitFor: () => new Promise(() => {}),
        withTimeout: (_wait: unknown, reason: string) =>
            Promise.reject(new Error(`Timeout after 6000ms: ${reason}`)),
    } as unknown as TaskContext;
    mocks.scanImportable.mockResolvedValue({
        kind: "FUNCTION",
        importable,
        needsHydration: false,
        plan: () => ({
            kind: "FUNCTION",
            importable,
            applicationPlan: cacheApplicationPlan,
            applicationUnits: cacheApplicationPlan.totalUnits,
            isNoOp: () => false,
            apply: () =>
                addAction(
                    ctx,
                    message("new"),
                    undefined as never,
                    {} as never,
                    0,
                    undefined
                ),
            reconstructObserved: () => null,
            reconstructPartial: () => null,
        }),
    });
    const events: SyncEvent[] = [];
    await runImportSession(ctx, {
        importables: [importable],
        trustMode: false,
        housingUuid: "test-house",
        sourcePath: "./project/import.json",
        parsed: { value: [importable] } as never,
        conflictHandling: { kind: "proceed" },
        events: { emit: (event) => events.push(event) },
    });
    expect(click).toHaveBeenCalledOnce();
    const finished = events.find(
        (event) => event.kind === "importableFinished" && event.status === "failed"
    );
    if (finished?.kind !== "importableFinished") throw new Error("No failed import event");
    expect(finished.error).toMatch(
        /^Failed to import FUNCTION: HTSW_INCOMPLETE_READ: Timeout after 6000ms:/
    );
    expect(finished.error).toContain(
        'After clicking Add Action option "Send a Chat Message"'
    );
});

afterEach(() => vi.restoreAllMocks());
