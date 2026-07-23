import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportableFunction } from "htsw/types";

import { scanConflictVerdict } from "../src/housingSync/actions/conflicts";
import { actionListScanHashFromActions } from "../src/housingSync/actions/scanHash";
import { createProjectItemIndex } from "../src/importables/items/projectItems";
import { createItemDependencyIndex } from "../src/importables/items/dependencyIndex";
import { createItemFieldResolver } from "../src/importables/items/resolveItem";
import type { ActionSyncContext } from "../src/housingSync/actions/syncContext";
import type TaskContext from "../src/tasks/context";
import { changeVar, message, observedSlot, playSound } from "./utils";

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

import { readActionListPlan } from "../src/housingSync/actions/plan";

function sessionWithLock(
    importable: ImportableFunction,
    lockedActions: ImportableFunction["actions"]
): ActionSyncContext {
    const items = createProjectItemIndex([]);
    const itemDependencies = createItemDependencyIndex([], items);
    return {
        canonicalizeItemName: (name) => items.canonicalizeObservedName(name),
        resolveItem: createItemFieldResolver(items, itemDependencies, "test-house"),
        trust: {
            housingUuid: "test-house",
            trustMode: true,
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
