import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
    Action,
    Importable,
    ImportableFunction,
    ImportableItem,
} from "htsw/types";

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
        importables: readonly Importable[],
        trustMode: boolean
    ) => ({
        housingUuid,
        trustMode,
        importables: new Map(
            importables.map((importable) => {
                const identity =
                    importable.type === "EVENT"
                        ? importable.event
                        : importable.type === "NPC"
                          ? `${importable.pos.x},${importable.pos.y},${importable.pos.z}`
                          : importable.name;
                return [
                    `${importable.type}:${identity}`,
                    {
                    importable,
                    identity,
                    entry: null,
                    sourceHash: "",
                    cacheHash: null,
                    lockHash: null,
                    lockListScanHashes: { actions: "baseline" },
                    lockListContentHashes: { actions: "baseline-content" },
                    cacheMatchesLock: true,
                    trustMode: false,
                    wholeImportableTrusted:
                        "name" in importable && importable.name === "Trusted",
                    trustedChildListPaths: new Set(),
                    trustedChildLists: new Map(),
                },
                ];
            })
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

import { runImportSession } from "../src/importables/import/session";
import type { SyncEvent } from "../src/housingSync/syncEvents";
import { createTaskCancelledError } from "../src/tasks/cancellation";
import type TaskContext from "../src/tasks/context";
import { changeVar, message, observedSlot, playSound } from "./utils";
import { conflictAwaitingConfirmationMessage } from "../src/importables/import/conflictChat";
import { resolveImportConflictPolicy } from "../src/importables/import/conflictResolution";
import { applyActionListPlan } from "../src/housingSync/actions/apply";
import { ActionListApplyRun } from "../src/housingSync/actions/apply/run";
import { createKnownActionListPlan } from "../src/housingSync/actions/plan";
import {
    actionSyncConflictIdentifier,
    type ObservedConflictList,
} from "../src/housingSync/actions/syncContext";
import { canonicalItemShellTagKey } from "../src/housingSync/items/itemNbt";
import type { TagLike } from "../src/housingSync/items/itemTag";

const actionListApply = vi.spyOn(ActionListApplyRun.prototype, "apply");

describe("import conflict gate", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.applyImportablePlan.mockResolvedValue(undefined);
        mocks.hydrateImportable.mockResolvedValue(undefined);
        mocks.tryWriteImportableCache.mockResolvedValue(true);
        mocks.deleteImportableCache.mockReturnValue(true);
        mocks.upsertHouseLockImportables.mockReturnValue(true);
        actionListApply.mockReset();
        actionListApply.mockResolvedValue({ currentSnapshot: [] });
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

    it("applies changed plans, skips through the real list boundary, and reports only changed lists", async () => {
        const trusted: ImportableFunction = {
            type: "FUNCTION",
            name: "Trusted",
            actions: [message("trusted")],
        };
        const noOp: ImportableFunction = {
            type: "FUNCTION",
            name: "NoOp",
            actions: [message("same")],
        };
        const clean: ImportableFunction = {
            type: "FUNCTION",
            name: "Clean",
            actions: [message("clean source")],
        };
        const accepted: ImportableFunction = {
            type: "FUNCTION",
            name: "Accepted",
            actions: [playSound()],
        };
        const skipped: ImportableFunction = {
            type: "FUNCTION",
            name: "Skipped",
            actions: [changeVar()],
        };
        const liveByName: Record<string, ImportableFunction["actions"]> = {
            NoOp: [message("same")],
            Clean: [message("clean live")],
            Accepted: [message("accepted live")],
            Skipped: [message("skipped live")],
        };
        mocks.scanImportable.mockImplementation(
            async (
                _ctx: unknown,
                importable: ImportableFunction,
                session: {
                    actions: Parameters<typeof createKnownActionListPlan>[2]["sync"];
                }
            ) => {
                const target = {
                    type: "FUNCTION" as const,
                    identity: importable.name,
                    basePath: "actions",
                };
                return {
                    kind: "FUNCTION",
                    importable,
                    needsHydration: true,
                    hydrate: mocks.hydrateImportable,
                    plan: () => {
                        const actionPlan = createKnownActionListPlan(
                            importable.actions ?? [],
                            liveByName[importable.name] ?? [],
                            { sync: session.actions, conflictTarget: target }
                        );
                        return {
                            kind: "FUNCTION",
                            importable,
                            isNoOp: () => actionPlan.diff.operations.length === 0,
                            apply: (
                                applyCtx: TaskContext,
                                applySession: typeof session
                            ) =>
                                applyActionListPlan(applyCtx, actionPlan, {
                                    sync: applySession.actions,
                                }).then(() => undefined),
                            reconstructObserved: () => null,
                            reconstructPartial: () => null,
                        };
                    },
                };
            }
        );
        const ctx = {
            sleep: async () => undefined,
            displayMessage: vi.fn(),
        } as unknown as TaskContext;

        const result = await runImportSession(ctx, {
            importables: [trusted, noOp, clean, accepted, skipped],
            trustMode: true,
            housingUuid: "test-house",
            sourcePath: "./project/import.json",
            parsed: {
                value: [trusted, noOp, clean, accepted, skipped],
            } as never,
            resolveConflicts: async (conflicts) => {
                const decision = resolveImportConflictPolicy(
                    conflicts,
                    ["FUNCTION:Accepted"],
                    "skip"
                );
                if (decision.kind !== "resolved") {
                    throw new Error(`Unexpected ${decision.kind} decision`);
                }
                return decision.resolution;
            },
        });

        expect(result).toEqual({
            appliedLists: 2,
            skippedConflicts: [
                {
                    type: "FUNCTION",
                    identity: "Skipped",
                    basePath: "actions",
                },
            ],
        });
        expect(actionListApply).toHaveBeenCalledTimes(2);
        expect(mocks.tryWriteImportableCache).toHaveBeenCalledWith(
            ctx,
            expect.objectContaining({
                name: "Skipped",
                actions: liveByName.Skipped,
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

    it("applies a fully named accept under cancel policy", async () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Accepted",
            actions: [playSound()],
        };
        mocks.scanImportable.mockImplementation(
            async (
                _ctx: unknown,
                _importable: ImportableFunction,
                session: {
                    actions: Parameters<typeof createKnownActionListPlan>[2]["sync"];
                }
            ) => ({
                kind: "FUNCTION",
                importable,
                needsHydration: false,
                hydrate: mocks.hydrateImportable,
                plan: () => {
                    const actionPlan = createKnownActionListPlan(
                        importable.actions ?? [],
                        [message("live")],
                        {
                            sync: session.actions,
                            conflictTarget: {
                                type: "FUNCTION",
                                identity: "Accepted",
                                basePath: "actions",
                            },
                        }
                    );
                    return {
                        kind: "FUNCTION",
                        importable,
                        isNoOp: () => false,
                        apply: (
                            applyCtx: TaskContext,
                            applySession: typeof session
                        ) =>
                            applyActionListPlan(applyCtx, actionPlan, {
                                sync: applySession.actions,
                            }).then(() => undefined),
                        reconstructObserved: () => null,
                        reconstructPartial: () => null,
                    };
                },
            })
        );
        const ctx = {
            sleep: async () => undefined,
            displayMessage: vi.fn(),
        } as unknown as TaskContext;

        const result = await runImportSession(ctx, {
            importables: [importable],
            trustMode: true,
            housingUuid: "test-house",
            sourcePath: "./project/import.json",
            parsed: { value: [importable] } as never,
            resolveConflicts: async (conflicts) => {
                const decision = resolveImportConflictPolicy(
                    conflicts,
                    ["FUNCTION:Accepted"],
                    "cancel"
                );
                if (decision.kind !== "resolved") {
                    return { accepted: [], skipped: [] };
                }
                return decision.resolution;
            },
        });

        expect(result.appliedLists).toBe(1);
        expect(actionListApply).toHaveBeenCalledOnce();
    });

    it("rejects an unmatched accept against an empty conflict set before writes", async () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Clean",
            actions: [message("same")],
        };
        mocks.scanImportable.mockResolvedValue({
            kind: "FUNCTION",
            importable,
            needsHydration: false,
            hydrate: mocks.hydrateImportable,
            plan: () => ({
                kind: "FUNCTION",
                importable,
                isNoOp: () => true,
                apply: mocks.applyImportablePlan,
                reconstructObserved: () => null,
                reconstructPartial: () => null,
            }),
        });
        const ctx = {
            sleep: async () => undefined,
            displayMessage: vi.fn(),
        } as unknown as TaskContext;

        await expect(
            runImportSession(ctx, {
                importables: [importable],
                trustMode: true,
                housingUuid: "test-house",
                sourcePath: "./project/import.json",
                parsed: { value: [importable] } as never,
                resolveConflicts: async (conflicts) => {
                    const decision = resolveImportConflictPolicy(
                        conflicts,
                        ["FUNCTION:Typo"],
                        "cancel"
                    );
                    return decision.kind === "resolved"
                        ? decision.resolution
                        : { accepted: [], skipped: [] };
                },
            })
        ).rejects.toThrow(
            "--accept did not match any conflicted list: FUNCTION:Typo"
        );

        expect(mocks.applyImportablePlan).not.toHaveBeenCalled();
        expect(mocks.tryWriteImportableCache).not.toHaveBeenCalled();
        expect(mocks.upsertHouseLockImportables).not.toHaveBeenCalled();
    });

    it("rejects an incomplete skipped observation before applying anything", async () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Unreadable",
            actions: [playSound()],
        };
        const conflict = {
            type: "FUNCTION" as const,
            identity: "Unreadable",
            basePath: "actions",
        };
        const unreadable = observedSlot(0, message("unreadable"));
        unreadable.action = null;
        unreadable.hydrated = false;
        mocks.scanImportable.mockImplementation(
            async (
                _ctx: unknown,
                _importable: ImportableFunction,
                session: {
                    actions: {
                        conflicts: typeof conflict[];
                        observedConflictLists: Map<string, ObservedConflictList>;
                    };
                }
            ) => {
                session.actions.conflicts.push(conflict);
                session.actions.observedConflictLists.set(
                    actionSyncConflictIdentifier(conflict),
                    { kind: "slots", slots: [unreadable] }
                );
                return {
                    kind: "FUNCTION",
                    importable,
                    needsHydration: false,
                    hydrate: mocks.hydrateImportable,
                    plan: () => ({
                        kind: "FUNCTION",
                        importable,
                        isNoOp: () => false,
                        apply: mocks.applyImportablePlan,
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

        await expect(
            runImportSession(ctx, {
                importables: [importable],
                trustMode: true,
                housingUuid: "test-house",
                sourcePath: "./project/import.json",
                parsed: { value: [importable] } as never,
                resolveConflicts: async () => ({
                    accepted: [],
                    skipped: [conflict],
                }),
            })
        ).rejects.toThrow(
            "Cannot skip conflicted list FUNCTION:Unreadable:actions: " +
                "its live contents could not be read completely."
        );

        expect(mocks.applyImportablePlan).not.toHaveBeenCalled();
        expect(mocks.tryWriteImportableCache).not.toHaveBeenCalled();
        expect(mocks.upsertHouseLockImportables).not.toHaveBeenCalled();
    });

    it("leaves successful ITEM cache persistence with the item importer", async () => {
        const importable: ImportableItem = {
            type: "ITEM",
            name: "Wand",
            nbt: {
                type: "compound",
                value: {
                    id: { type: "string", value: "minecraft:stick" },
                },
            },
        };
        const ctx = {
            sleep: async () => undefined,
            displayMessage: vi.fn(),
        } as unknown as TaskContext;
        mocks.scanImportable.mockResolvedValue({
            kind: "ITEM",
            importable,
            needsHydration: false,
            hydrate: mocks.hydrateImportable,
            plan: () => ({
                kind: "ITEM",
                importable,
                isNoOp: () => false,
                apply: async () => {
                    await mocks.tryWriteImportableCache();
                },
                reconstructObserved: () => null,
                reconstructPartial: () => null,
            }),
        });

        await runImportSession(ctx, {
            importables: [importable],
            trustMode: false,
            housingUuid: "test-house",
            sourcePath: "./project/import.json",
            parsed: { value: [importable] } as never,
        });

        expect(mocks.tryWriteImportableCache).toHaveBeenCalledOnce();
        expect(mocks.upsertHouseLockImportables).toHaveBeenCalledWith(
            "./project/import.json",
            "test-house",
            [
                expect.objectContaining({
                    importable,
                }),
            ]
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
                itemContent: (
                    owner: Action,
                    property: string
                ) => { key: string; tag: TagLike } | undefined;
            };
        };
        cancellation.__htswActionListApplyResult = {
            currentSnapshot: [partialItem],
            itemContent: (owner, property) =>
                owner === partialItem && property === "itemName"
                    ? { key: observedKey, tag: observedTag }
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
                isNoOp: () => false,
                apply: async () => {
                    throw cancellation;
                },
                reconstructObserved: () => importable,
                reconstructPartial: (result: {
                    currentSnapshot: Action[];
                } | null) =>
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
            })
        ).rejects.toMatchObject({ __taskCancelled: true });

        const updates = mocks.upsertHouseLockImportables.mock.calls[0][2] as Array<{
            importable: ImportableFunction;
            itemContent: (
                owner: Action,
                property: string
            ) => { key: string } | undefined;
        }>;
        const update = updates.find(
            (entry) => entry.importable.name === "Partial"
        )!;
        const reconstructedItem = update.importable.actions![0];
        expect(update.itemContent(reconstructedItem, "itemName")?.key).toBe(
            observedKey
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
