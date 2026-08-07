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
import { scanActionListSync } from "../src/housingSync/actions/prepareSync";

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
        conflictEvidence: [],
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
        expect(session.conflictEvidence).toEqual([
            expect.objectContaining({
                type: "FUNCTION",
                identity: "Debug",
                basePath: "actions",
                liveActions: [changeVar()],
                sourceActions: [playSound()],
                canonicalDifferences: [
                    expect.objectContaining({
                        path: "action 1 (change var) · type",
                    }),
                ],
            }),
        ]);
        expect(mocks.hydrateActionListScan).toHaveBeenCalledOnce();
    });

    it("reports a known conflict before hydration even when the cache baseline is missing", async () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Debug",
            actions: [playSound()],
        };
        mocks.scanActionList.mockResolvedValue({
            slots: [observedSlot(0, changeVar())],
        });
        const session = sessionWithLock(importable, [message("baseline")]);
        const reasons: string[] = [];
        session.events = {
            emit: (event) => {
                if (event.kind === "knowledgeSourceUsed") reasons.push(event.reason);
            },
        };
        const trustPlan = session.trust.importables.get("FUNCTION:Debug");

        const result = await scanActionListSync(null as unknown as TaskContext, {
            desired: importable.actions,
            sync: session,
            trustPlan,
            basePath: "actions",
            conflictTarget: {
                type: importable.type,
                identity: importable.name,
                basePath: "actions",
            },
        });

        expect(result.kind).toBe("hydrate");
        expect(reasons[reasons.length - 1]).toBe("lock-conflict");
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

    it("does not record a prompt-worthy conflict when hashes disagree but canonical fields do not", async () => {
        const append = vi.fn();
        vi.stubGlobal("FileLib", {
            ...(FileLib as unknown as Record<string, unknown>),
            append,
        });
        const desired = {
            type: "DROP_ITEM",
            itemName: "red_wool",
            location: { type: "Current Location" },
        } as Action;
        const observed = JSON.parse(JSON.stringify(desired)) as Action;
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "force_accel",
            actions: [desired],
        };
        mocks.scanActionList.mockResolvedValue({
            slots: [observedSlot(0, observed)],
        });
        const session = sessionWithLock(importable, [desired], false);
        const canonicalItem = () => "canonical-red-wool";
        session.itemDiff = {
            hasActionList: () => false,
            actionsDiffer: () => false,
            conditionsDiffer: () => false,
            fieldContent: (owner) =>
                owner === desired ? canonicalItem() : undefined,
        };
        session.trust.importables.get("FUNCTION:force_accel")!.lockListContentHashes = {
            actions: actionListContentHashFromActions([desired], canonicalItem),
        };

        await readActionListPlan(null as unknown as TaskContext, importable.actions!, {
            sync: session,
            conflictTarget: {
                type: "FUNCTION",
                identity: "force_accel",
                basePath: "actions",
            },
        });

        expect(session.conflicts).toEqual([]);
        expect(session.conflictEvidence).toEqual([
            expect.objectContaining({ canonicalDifferences: [] }),
        ]);
        expect(JSON.parse(String(append.mock.calls[0][1]))).toEqual(
            expect.objectContaining({ hashComparisonDisagreement: true })
        );
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

});
