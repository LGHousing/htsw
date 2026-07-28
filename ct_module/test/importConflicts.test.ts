import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Action, ImportableFunction } from "htsw/types";

import { scanConflictVerdict } from "../src/housingSync/actions/conflicts";
import {
    actionListContentHashFromActions,
    actionListScanHashFromActions,
} from "../src/housingSync/actions/scanHash";
import { createProjectItemIndex } from "../src/importables/items/projectItems";
import { createItemDependencyIndex } from "../src/importables/items/dependencyIndex";
import { createItemFieldResolver } from "../src/importables/items/resolveItem";
import type { OverwriteWarningMode } from "../src/importables/overwriteWarning";
import type { ActionSyncContext } from "../src/housingSync/actions/syncContext";
import { actionSyncConflictIdentifier } from "../src/housingSync/actions/syncContext";
import {
    itemFieldContentFromSnapshot,
    type ItemFieldContent,
} from "../src/housingSync/items/fieldContent";
import type { TagLike } from "../src/housingSync/items/itemTag";
import type TaskContext from "../src/tasks/context";
import { changeVar, conditional, message, observedSlot, playSound } from "./utils";

const mocks = vi.hoisted(() => ({
    scanActionList: vi.fn(),
    hydrateActionListScan: vi.fn(async () => undefined),
}));

vi.mock("../src/housingSync/actions/readList", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../src/housingSync/actions/readList")>()),
    scanActionList: mocks.scanActionList,
}));

vi.mock("../src/housingSync/actions/hydration/run", async (importOriginal) => ({
    ...(await importOriginal<
        typeof import("../src/housingSync/actions/hydration/run")
    >()),
    hydrateActionListScan: mocks.hydrateActionListScan,
}));

import {
    readActionListPlan,
    scanActionListForPlan,
} from "../src/housingSync/actions/plan";

function sessionWithLock(
    importable: ImportableFunction,
    lockedActions: ImportableFunction["actions"],
    trustedImport = true,
    overwriteWarningMode: OverwriteWarningMode = "always",
    includeContentHashes = true
): ActionSyncContext {
    const items = createProjectItemIndex([]);
    const itemDependencies = createItemDependencyIndex([], items);
    return {
        canonicalizeItemName: (name) => items.canonicalizeObservedName(name),
        resolveItem: createItemFieldResolver(items, itemDependencies, "test-house"),
        trust: {
            housingUuid: "test-house",
            trustMode: trustedImport,
            importables: new Map([
                [
                    `FUNCTION:${importable.name}`,
                    {
                        importable,
                        identity: importable.name,
                        entry: null,
                        sourceHash: "",
                        cacheHash: null,
                        lockHash: null,
                        lockListScanHashes: {
                            actions: actionListScanHashFromActions(lockedActions ?? []),
                        },
                        lockListContentHashes: includeContentHashes
                            ? {
                                  actions: actionListContentHashFromActions(
                                      lockedActions ?? []
                                  ),
                              }
                            : null,
                        cacheMatchesLock: true,
                        breakdown: {
                            dependenciesMatch: true,
                            itemBlobAvailable: true,
                            cacheMatchesLock: true,
                        },
                        trustMode: false,
                        wholeImportableTrusted: false,
                        trustedChildListPaths: new Set(),
                        trustedChildLists: new Map(),
                        trustedItemOwners: new WeakSet(),
                    },
                ],
            ]),
        },
        overwriteWarningMode,
        conflicts: [],
        events: undefined,
        itemRead: { mode: "sync" },
    };
}

describe("scanConflictVerdict", () => {
    it.each([
        ["live", undefined, "source", "no-baseline"],
        ["baseline", "baseline", "source", "unchanged"],
        ["source", "baseline", "source", "already-applied"],
        ["live", "baseline", "source", "conflict"],
    ] as const)("returns %s/%s/%s as %s", (liveHash, lockHash, sourceHash, verdict) => {
        expect(scanConflictVerdict(liveHash, lockHash, sourceHash)).toBe(verdict);
    });
});

describe("readActionListPlan conflict detection", () => {
    beforeEach(() => {
        mocks.scanActionList.mockReset();
        mocks.hydrateActionListScan.mockClear();
    });

    it("records a live scan that differs from both the lock and source", async () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: [playSound()],
        };
        mocks.scanActionList.mockResolvedValue({
            slots: [observedSlot(0, changeVar())],
        });
        const session = sessionWithLock(importable, [message("baseline")]);

        await readActionListPlan(null as unknown as TaskContext, importable.actions!, {
            sync: session,
            conflictTarget: {
                type: importable.type,
                identity: importable.name,
                basePath: "actions",
            },
        });

        expect(session.conflicts).toEqual([
            { type: "FUNCTION", identity: "Debug", basePath: "actions" },
        ]);
        expect(mocks.hydrateActionListScan).toHaveBeenCalledOnce();
    });

    it("records an unreadable live slot when its scan conflicts", async () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: [playSound()],
        };
        const unreadable = observedSlot(0, message("unreadable"));
        unreadable.action = null;
        unreadable.hydrated = false;
        mocks.scanActionList.mockResolvedValue({ slots: [unreadable] });
        const session = sessionWithLock(importable, [message("baseline")]);
        session.observedConflictLists = new Map();
        const target = {
            type: "FUNCTION" as const,
            identity: "Debug",
            basePath: "actions",
        };

        await readActionListPlan(null as unknown as TaskContext, importable.actions!, {
            sync: session,
            conflictTarget: target,
        });

        expect(session.conflicts).toEqual([target]);
        expect(
            session.observedConflictLists.get(actionSyncConflictIdentifier(target))
        ).toEqual({ kind: "slots", slots: [unreadable] });
    });

    it("detects an untrusted content conflict without an import cache entry", async () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: [message("source")],
        };
        mocks.scanActionList.mockResolvedValue({
            slots: [observedSlot(0, message("live"))],
        });
        const session = sessionWithLock(
            importable,
            [message("lock")],
            false
        );

        await readActionListPlan(null as unknown as TaskContext, importable.actions!, {
            sync: session,
            conflictTarget: {
                type: importable.type,
                identity: importable.name,
                basePath: "actions",
            },
        });

        expect(
            session.trust.importables.get("FUNCTION:Debug")?.entry
        ).toBeNull();
        expect(session.conflicts).toEqual([
            { type: "FUNCTION", identity: "Debug", basePath: "actions" },
        ]);
    });

    it("records no untrusted verdict when a slot remains unhydrated", async () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: [message("source")],
        };
        const live = observedSlot(0, message("live"));
        live.hydrated = false;
        mocks.scanActionList.mockResolvedValue({ slots: [live] });
        const session = sessionWithLock(
            importable,
            [message("lock")],
            false
        );

        await readActionListPlan(null as unknown as TaskContext, importable.actions!, {
            sync: session,
            conflictTarget: {
                type: importable.type,
                identity: importable.name,
                basePath: "actions",
            },
        });

        expect(session.conflicts).toEqual([]);
    });

    it("falls back to structure comparison for a v1 scan-only lock", async () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: [playSound()],
        };
        mocks.scanActionList.mockResolvedValue({
            slots: [observedSlot(0, changeVar())],
        });
        const session = sessionWithLock(
            importable,
            [message("lock")],
            false,
            "always",
            false
        );

        await readActionListPlan(null as unknown as TaskContext, importable.actions!, {
            sync: session,
            conflictTarget: {
                type: importable.type,
                identity: importable.name,
                basePath: "actions",
            },
        });

        expect(session.conflicts).toEqual([
            { type: "FUNCTION", identity: "Debug", basePath: "actions" },
        ]);
    });

    it.each([true, false])(
        "warnmode off disables the %s import check",
        async (trustedImport) => {
            const importable: ImportableFunction = {
                type: "FUNCTION",
                name: "Debug",
                actions: [playSound()],
            };
            mocks.scanActionList.mockResolvedValue({
                slots: [observedSlot(0, changeVar())],
            });
            const session = sessionWithLock(
                importable,
                [message("lock")],
                trustedImport,
                "off"
            );

            await readActionListPlan(
                null as unknown as TaskContext,
                importable.actions!,
                {
                    sync: session,
                    conflictTarget: {
                        type: importable.type,
                        identity: importable.name,
                        basePath: "actions",
                    },
                }
            );

            expect(session.conflicts).toEqual([]);
        }
    );

    it.each([
        [true, 1],
        [false, 0],
    ] as const)(
        "warnmode trusted records %s import conflicts as expected",
        async (trustedImport, expectedConflicts) => {
            const importable: ImportableFunction = {
                type: "FUNCTION",
                name: "Debug",
                actions: [playSound()],
            };
            mocks.scanActionList.mockResolvedValue({
                slots: [observedSlot(0, changeVar())],
            });
            const session = sessionWithLock(
                importable,
                [message("lock")],
                trustedImport,
                "trusted"
            );

            await readActionListPlan(
                null as unknown as TaskContext,
                importable.actions!,
                {
                    sync: session,
                    conflictTarget: {
                        type: importable.type,
                        identity: importable.name,
                        basePath: "actions",
                    },
                }
            );

            expect(session.conflicts).toHaveLength(expectedConflicts);
        }
    );

    it("excludes trusted child lists from the initial hydration payload", async () => {
        const baseline = [
            conditional({
                ifActions: [message("same")],
            }),
        ];
        const desired = [
            conditional({
                matchAny: true,
                ifActions: [message("same")],
            }),
        ];
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: desired,
        };
        let initialHydratingUnits: number | undefined;
        mocks.scanActionList.mockImplementation(
            async (
                _ctx: unknown,
                _mode: unknown,
                read: { phaseUnits?: { hydrating: number } }
            ) => {
                initialHydratingUnits = read.phaseUnits?.hydrating;
                return { slots: [observedSlot(0, baseline[0])] };
            }
        );

        await scanActionListForPlan(
            null as unknown as TaskContext,
            desired,
            {
                sync: sessionWithLock(importable, baseline),
                baselineCurrent: baseline,
                trust: {
                    basePath: "actions",
                    trustedChildListPaths: new Set([
                        "actions[0].conditions",
                        "actions[0].ifActions",
                        "actions[0].elseActions",
                    ]),
                    trustedChildLists: new Map(),
                },
            }
        );

        expect(initialHydratingUnits).toBe(0);
    });

    it("reuses the trusted baseline when the live scan still matches the lock", async () => {
        const baseline = [message("baseline")];
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: [message("desired")],
        };
        mocks.scanActionList.mockResolvedValue({
            slots: [observedSlot(0, message("shallow live value"))],
        });
        const session = sessionWithLock(importable, baseline);

        const plan = await readActionListPlan(
            null as unknown as TaskContext,
            importable.actions!,
            {
                sync: session,
                baselineCurrent: baseline,
                trustedBaselineAfterUnchangedScan: baseline,
                conflictTarget: {
                    type: importable.type,
                    identity: importable.name,
                    basePath: "actions",
                },
            }
        );

        expect(mocks.hydrateActionListScan).not.toHaveBeenCalled();
        expect(plan.observed[0].action).toEqual(message("baseline"));
        expect(plan.phaseUnits.hydrating).toBe(0);
        expect(session.conflicts).toEqual([]);
    });

    it("uses staged hydration when the cheap live scan still matches", async () => {
        const cached = [message("cached live")];
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: [message("desired")],
        };
        mocks.scanActionList.mockResolvedValue({
            slots: [observedSlot(0, message("shallow live"))],
        });
        const session = sessionWithLock(importable, [message("baseline")], false);
        session.trust.importables.get("FUNCTION:Debug")!.stagedActionLists = new Map([
            [
                "actions",
                {
                    scanHash: actionListScanHashFromActions(cached),
                    contentHash: actionListContentHashFromActions(cached),
                    actions: cached,
                },
            ],
        ]);

        const plan = await readActionListPlan(
            null as unknown as TaskContext,
            importable.actions!,
            {
                sync: session,
                conflictTarget: {
                    type: "FUNCTION",
                    identity: "Debug",
                    basePath: "actions",
                },
            }
        );

        expect(mocks.hydrateActionListScan).not.toHaveBeenCalled();
        expect(plan.observed[0].action).toEqual(message("cached live"));
        expect(session.conflicts).toHaveLength(1);
    });

    it("uses captured canonical item content on a staged cache hit", async () => {
        const source = {
            type: "GIVE_ITEM",
            itemName: "mvp_cookies.snbt",
        } as Action;
        const live = {
            type: "GIVE_ITEM",
            itemName: "mvp_002b_cookies__0028right_click_0029",
        } as Action;
        const cookie: TagLike = {
            type: "compound",
            value: { id: { type: "string", value: "minecraft:cookie" } },
        };
        const sourceItemContent: ItemFieldContent = (owner) =>
            owner === source ? { key: "cookie", tag: cookie } : undefined;
        const stagedItemFields = {
            mvp_002b_cookies__0028right_click_0029: {
                key: "cookie",
                tag: cookie,
            },
        };
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: [source],
        };
        mocks.scanActionList.mockResolvedValue({
            slots: [observedSlot(0, live)],
        });
        const session = sessionWithLock(importable, [source], false);
        session.itemDiff = {
            hasActionList: () => false,
            actionsDiffer: () => false,
            conditionsDiffer: () => false,
            fieldContent: sourceItemContent,
        };
        session.trust.importables.get("FUNCTION:Debug")!.lockListContentHashes = {
            actions: actionListContentHashFromActions([source], sourceItemContent),
        };
        session.trust.importables.get("FUNCTION:Debug")!.stagedActionLists = new Map([
            [
                "actions",
                {
                    scanHash: actionListScanHashFromActions([live]),
                    contentHash: actionListContentHashFromActions(
                        [live],
                        itemFieldContentFromSnapshot(stagedItemFields)
                    ),
                    actions: [live],
                    itemFields: stagedItemFields,
                },
            ],
        ]);

        await readActionListPlan(null as unknown as TaskContext, [source], {
            sync: session,
            conflictTarget: {
                type: "FUNCTION",
                identity: "Debug",
                basePath: "actions",
            },
        });

        expect(mocks.hydrateActionListScan).not.toHaveBeenCalled();
        expect(session.conflicts).toEqual([]);
    });

    it.each([
        ["changed scan", false],
        ["fresh import", true],
    ] as const)("rehydrates staged data on %s", async (_label, freshHydration) => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: [message("desired")],
        };
        mocks.scanActionList.mockResolvedValue({
            slots: [observedSlot(0, playSound())],
        });
        const session = sessionWithLock(importable, [message("baseline")], false);
        session.freshHydration = freshHydration;
        session.trust.importables.get("FUNCTION:Debug")!.stagedActionLists = new Map([
            [
                "actions",
                {
                    scanHash: actionListScanHashFromActions(
                        freshHydration ? [playSound()] : [message("cached")]
                    ),
                    contentHash: actionListContentHashFromActions([message("cached")]),
                    actions: [message("cached")],
                },
            ],
        ]);

        await readActionListPlan(null as unknown as TaskContext, importable.actions!, {
            sync: session,
            conflictTarget: {
                type: "FUNCTION",
                identity: "Debug",
                basePath: "actions",
            },
        });

        expect(mocks.hydrateActionListScan).toHaveBeenCalledOnce();
    });
});
