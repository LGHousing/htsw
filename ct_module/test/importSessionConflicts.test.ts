import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportableFunction } from "htsw/types";

const mocks = vi.hoisted(() => ({
    applyImportablePlan: vi.fn(async () => undefined),
    scanImportable: vi.fn(),
    hydrateImportable: vi.fn(async () => undefined),
    tryWriteImportableCache: vi.fn(async () => true),
    deleteImportableCache: vi.fn(() => true),
    upsertHouseLockImportables: vi.fn(() => true),
    lockListContentHashJournal: undefined as
        | Record<string, Array<{ hash: string; recordedAt: string }>>
        | undefined,
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
                    lockListContentHashJournal: mocks.lockListContentHashJournal,
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

vi.mock("../src/importCache/houseLock", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/importCache/houseLock")>()),
    upsertHouseLockImportables: mocks.upsertHouseLockImportables,
}));

vi.mock("../src/runtimeDebug/importFailureLog", () => ({
    writeImportFailureLog: () => "./failure.log",
}));

import { runImportSession } from "../src/importables/import/session";
import type { SyncEvent } from "../src/housingSync/syncEvents";
import { createTaskCancelledError } from "../src/tasks/cancellation";
import type TaskContext from "../src/tasks/context";
import { message } from "./utils";
import { conflictAwaitingConfirmationMessage } from "../src/importables/import/conflictChat";
import { conflictIdentifier } from "../src/importables/import/conflictResolution";
import { actionListContentHashFromActions } from "../src/housingSync/actions/scanHash";

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
        mocks.lockListContentHashJournal = undefined;
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
            confirmConflicts: async () => false,
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

    it("applies clean lists, skips conflicted lists, and preserves only skipped baselines", async () => {
        const clean: ImportableFunction = {
            type: "FUNCTION",
            name: "Clean",
            actions: [message("clean source")],
        };
        const conflicted: ImportableFunction = {
            type: "FUNCTION",
            name: "Conflicted",
            actions: [message("conflicted source")],
        };
        const liveConflict = [message("live edit")];
        const conflict = {
            type: "FUNCTION" as const,
            identity: "Conflicted",
            basePath: "actions",
        };
        mocks.scanImportable.mockImplementation(
            async (
                _ctx: unknown,
                importable: ImportableFunction,
                session: {
                    actions: {
                        conflicts: typeof conflict[];
                        conflictTargets: typeof conflict[];
                        observedConflictLists: Map<string, ReturnType<typeof message>[]>;
                    };
                }
            ) => {
                const target = {
                    type: "FUNCTION" as const,
                    identity: importable.name,
                    basePath: "actions",
                };
                session.actions.conflictTargets.push(target);
                if (importable === conflicted) {
                    session.actions.conflicts.push(conflict);
                    session.actions.observedConflictLists.set(
                        conflictIdentifier(conflict),
                        liveConflict
                    );
                }
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
                        apply: async (
                            _applyCtx: unknown,
                            applySession: {
                                actions: { skippedConflicts?: ReadonlySet<string> };
                            }
                        ) => {
                            if (
                                !applySession.actions.skippedConflicts?.has(
                                    conflictIdentifier(target)
                                )
                            ) {
                                await mocks.applyImportablePlan();
                            }
                        },
                        reconstructObserved: () => null,
                        reconstructPartial: () => null,
                    }),
                };
            }
        );
        const ctx = {
            sleep: async () => undefined,
            displayMessage: vi.fn(),
        } as unknown as TaskContext;

        const result = await runImportSession(ctx, {
            importables: [clean, conflicted],
            trustMode: true,
            housingUuid: "test-house",
            sourcePath: "./project/import.json",
            parsed: { value: [clean, conflicted] } as never,
            resolveConflicts: async () => ({
                accepted: [],
                skipped: [conflict],
            }),
        });

        expect(result).toEqual({
            appliedLists: 1,
            skippedConflicts: [conflict],
        });
        expect(mocks.applyImportablePlan).toHaveBeenCalledTimes(1);
        expect(mocks.tryWriteImportableCache).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                name: "Conflicted",
                actions: liveConflict,
            }),
            "importer",
            "test-house",
            expect.anything()
        );
        expect(mocks.upsertHouseLockImportables).toHaveBeenCalledWith(
            "./project/import.json",
            "test-house",
            expect.arrayContaining([
                expect.objectContaining({
                    importable: clean,
                    preserveListPaths: [],
                }),
                expect.objectContaining({
                    preserveListPaths: ["actions"],
                }),
            ])
        );
    });

    it("lists the current rollback paths inline before applying", async () => {
        const source = [message("older")];
        const live = [message("newer")];
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: source,
        };
        mocks.lockListContentHashJournal = {
            actions: [
                {
                    hash: actionListContentHashFromActions(source),
                    recordedAt: "2026-07-20T00:00:00.000Z",
                },
                {
                    hash: actionListContentHashFromActions(live),
                    recordedAt: "2026-07-27T00:00:00.000Z",
                },
            ],
        };
        mocks.scanImportable.mockImplementation(
            async (
                _ctx: unknown,
                _importable: unknown,
                session: {
                    actions: {
                        observedActionLists: Map<
                            string,
                            ReturnType<typeof message>[]
                        >;
                    };
                }
            ) => {
                session.actions.observedActionLists.set(
                    conflictIdentifier({
                        type: "FUNCTION",
                        identity: "Debug",
                        basePath: "actions",
                    }),
                    live
                );
                return {
                    kind: "FUNCTION",
                    importable,
                    needsHydration: false,
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
        const messages: string[] = [];
        const ctx = {
            sleep: async () => undefined,
            displayMessage: (text: string) => messages.push(text),
        } as unknown as TaskContext;

        await runImportSession(ctx, {
            importables: [importable],
            trustMode: false,
            housingUuid: "test-house",
            sourcePath: "./project/import.json",
            parsed: { value: [importable] } as never,
        });

        expect(messages).toContain(
            "[htsw] Warning: 1 action list would revert to an older recorded state:"
        );
        expect(messages).toContain('[htsw] Revert: FUNCTION "Debug" · actions');
        expect(messages.join("\n")).not.toContain("see report");
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
            })
        ).rejects.toMatchObject({ __taskCancelled: true });

        expect(mocks.tryWriteImportableCache).toHaveBeenCalledTimes(2);
        expect(mocks.upsertHouseLockImportables).toHaveBeenCalledTimes(1);
        expect(messages).toContain(
            "&a[htsw] Cancellation saved verified house state for &f2&a importables; retry can reuse the cache."
        );
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
            })
        ).rejects.toMatchObject({ __taskCancelled: true });

        expect(mocks.tryWriteImportableCache).not.toHaveBeenCalled();
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
