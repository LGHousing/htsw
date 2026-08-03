import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Action } from "htsw/types";

import type { ActionListDiff } from "../src/housingSync/actions/diff/types";
import type { ObservedActionSlot } from "../src/housingSync/observedActions";
import type { ActionListPlan } from "../src/housingSync/actions/plan";
import { createProjectItemIndex } from "../src/importables/items/projectItems";
import { createItemDependencyIndex } from "../src/importables/items/dependencyIndex";
import { createItemFieldResolver } from "../src/importables/items/resolveItem";
import type { ActionSyncContext } from "../src/housingSync/actions/syncContext";
import {
    baselineActionListFromSlots,
    diffActionList,
} from "../src/housingSync/actions/diff";
import { message, observedSlot } from "./utils";

const mocks = vi.hoisted(() => ({
    clickGoBack: vi.fn(async () => undefined),
    setListItemNote: vi.fn(
        async (
            _ctx: unknown,
            _slot: unknown,
            _note: unknown,
            options?: { onApplied?: () => void }
        ) => {
            options?.onApplied?.();
        }
    ),
    writeOpenAction: vi.fn(async () => undefined),
    getSlotPaginate: vi.fn(),
}));

vi.mock("../src/housingSync/menus/paginatedList", () => ({
    getPaginatedListSlotAtIndex: vi.fn(async () => ({
        click: vi.fn(),
    })),
    goToPaginatedListPage: vi.fn(async () => undefined),
}));

vi.mock("../src/housingSync/menus/menuWait", () => ({
    timedWaitForMenu: vi.fn(async () => undefined),
    waitForMenu: vi.fn(async () => undefined),
}));

vi.mock("../src/housingSync/menus/menuUtils", () => ({
    clickGoBack: mocks.clickGoBack,
    getSlotPaginate: mocks.getSlotPaginate,
    isLimitExceeded: vi.fn(() => false),
    setListItemNote: mocks.setListItemNote,
    setNoteOnLastVisibleSlot: vi.fn(
        async (_ctx: unknown, _note: unknown, options?: { onApplied?: () => void }) => {
            options?.onApplied?.();
        }
    ),
}));

vi.mock("../src/housingSync/actions/io", () => ({
    getActionIo: vi.fn(() => ({
        displayName: "Send a Chat Message",
        write: true,
    })),
    writeOpenAction: mocks.writeOpenAction,
}));

const oldAction = message("old");
const newAction = message("new");

function syncContext(): ActionSyncContext {
    const items = createProjectItemIndex([]);
    const itemDependencies = createItemDependencyIndex([], items);
    return {
        canonicalizeItemName: (name) => items.canonicalizeObservedName(name),
        resolveItem: createItemFieldResolver(items, itemDependencies, "test-house"),
        trust: {
            housingUuid: "test-house",
            trustMode: false,
            importables: new Map(),
        },
        overwriteWarningMode: "always",
        conflicts: [],
        conflictEvidence: [],
        events: undefined,
        itemRead: { mode: "sync" },
    };
}

function editPlan(observed: ObservedActionSlot[], desired: Action[]): ActionListPlan {
    const diff: ActionListDiff = {
        desiredLength: desired.length,
        operations: [
            {
                kind: "edit",
                entryId: 0,
                fromIndex: 0,
                desiredIndex: 0,
                baselineAction: oldAction,
                desired: newAction,
                noteOnly: false,
                noteDiffers: false,
                childListDiffs: [],
            },
        ],
    };
    return {
        desired,
        observed,
        diff,
        phaseUnits: {
            setup: 0,
            reading: 0,
            hydrating: 0,
            applying: 1,
        },
    };
}

function addPlan(observed: ObservedActionSlot[], desired: Action[]): ActionListPlan {
    return {
        desired,
        observed,
        diff: diffActionList(baselineActionListFromSlots(observed), desired),
        phaseUnits: {
            setup: 0,
            reading: 0,
            hydrating: 0,
            applying: 1,
        },
    };
}

describe("ActionListApplyResult", () => {
    beforeEach(() => {
        mocks.clickGoBack.mockReset();
        mocks.clickGoBack.mockResolvedValue(undefined);
        mocks.setListItemNote.mockClear();
        mocks.writeOpenAction.mockReset();
        mocks.writeOpenAction.mockResolvedValue(undefined);
        mocks.getSlotPaginate.mockReset();
    });

    test("does not expose a cacheable result when an edit writer throws before state is updated", async () => {
        mocks.writeOpenAction.mockRejectedValue(
            new Error("writer failed after touching the editor")
        );
        const { applyActionListPlan, actionListApplyResultFromError } =
            await import("../src/housingSync/actions/apply");

        let thrown: unknown = null;
        try {
            await applyActionListPlan(
                {
                    checkCancelled: () => undefined,
                    finishBeforeCancelling: async (run: () => Promise<unknown>) => run(),
                } as never,
                editPlan([observedSlot(0, oldAction)], [newAction]),
                { sync: syncContext() }
            );
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect(actionListApplyResultFromError(thrown)).toBeNull();
    });

    test("exposes the updated result when a confirmed edit is followed by a later failure", async () => {
        mocks.clickGoBack.mockRejectedValue(new Error("failed after writer returned"));
        const { applyActionListPlan, actionListApplyResultFromError } =
            await import("../src/housingSync/actions/apply");

        let thrown: unknown = null;
        try {
            await applyActionListPlan(
                {
                    checkCancelled: () => undefined,
                    finishBeforeCancelling: async (run: () => Promise<unknown>) => run(),
                } as never,
                editPlan([observedSlot(0, oldAction)], [newAction]),
                { sync: syncContext() }
            );
        } catch (error) {
            thrown = error;
        }

        expect(thrown).toBeInstanceOf(Error);
        expect(actionListApplyResultFromError(thrown)).toEqual({
            currentSnapshot: [newAction],
        });
    });

    test("keeps the previous result cacheable when opening Add Action fails before mutation", async () => {
        const { applyActionListPlan, actionListApplyResultFromError } =
            await import("../src/housingSync/actions/apply");
        const ctx = {
            checkCancelled: () => undefined,
            finishBeforeCancelling: async (run: () => Promise<unknown>) => run(),
            getMenuItemSlot: () => {
                throw new Error("Add Action is not in this menu");
            },
        };

        let thrown: unknown = null;
        try {
            await applyActionListPlan(
                ctx as never,
                addPlan([observedSlot(0, oldAction)], [oldAction, newAction]),
                { sync: syncContext() }
            );
        } catch (error) {
            thrown = error;
        }

        expect(actionListApplyResultFromError(thrown)).toEqual({
            currentSnapshot: [oldAction],
        });
    });

    test("does not expose a result after the Add Action choice may have mutated Housing", async () => {
        const { applyActionListPlan, actionListApplyResultFromError } =
            await import("../src/housingSync/actions/apply");
        mocks.getSlotPaginate.mockReturnValue({
            click: () => {
                throw new Error("selection failed after click");
            },
        });
        const ctx = {
            checkCancelled: () => undefined,
            finishBeforeCancelling: async (run: () => Promise<unknown>) => run(),
            getMenuItemSlot: () => ({ click: () => undefined }),
        };

        let thrown: unknown = null;
        try {
            await applyActionListPlan(
                ctx as never,
                addPlan([observedSlot(0, oldAction)], [oldAction, newAction]),
                { sync: syncContext() }
            );
        } catch (error) {
            thrown = error;
        }

        expect(actionListApplyResultFromError(thrown)).toBeNull();
    });
});
