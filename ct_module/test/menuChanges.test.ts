import { describe, expect, it } from "vitest";
import type { Action } from "htsw/types";

import {
    planMenuChanges,
    type MenuSlotSnapshot,
} from "../src/importables/menus/menuChanges";
import { menuActionBaseline } from "../src/importables/menus/import";
import type { ActionListPlan } from "../src/housingSync/actions/plan";
import { observedSlot } from "./utils";

function chat(message: string): Action {
    return { type: "MESSAGE", message };
}

// The planner only needs a "did these lists change" predicate; the real diff
// canonicalises first, but for slot-selection a raw structural compare is the
// faithful stand-in.
const actionsDiffer = (a: Action[], b: Action[]): boolean =>
    JSON.stringify(a) !== JSON.stringify(b);

function slot(
    slotId: number,
    itemKey: string,
    actions: Action[] = []
): MenuSlotSnapshot {
    return { slot: slotId, itemKey, actions };
}

function plan(
    desired: MenuSlotSnapshot[],
    baseline: MenuSlotSnapshot[],
    desiredSize?: number,
    baselineSize?: number
) {
    return planMenuChanges(desired, baseline, desiredSize, baselineSize, actionsDiffer);
}

describe("planMenuChanges", () => {
    it("touches nothing when every slot matches", () => {
        const slots = [slot(0, "stone", [chat("a")]), slot(4, "diamond")];
        const result = plan(slots, slots, 1, 1);
        expect(result.changes).toEqual([]);
        expect(result.clears).toEqual([]);
        expect(result.setSize).toBeNull();
    });

    it("writes only the one slot whose item changed", () => {
        const baseline = [slot(0, "stone"), slot(4, "diamond"), slot(8, "gold")];
        const desired = [slot(0, "stone"), slot(4, "emerald"), slot(8, "gold")];
        const result = plan(desired, baseline, 1, 1);
        expect(result.changes).toEqual([
            { slot: 4, desiredIndex: 1, setItem: true, setActions: false },
        ]);
        expect(result.clears).toEqual([]);
    });

    it("writes only the one slot whose actions changed", () => {
        const baseline = [slot(0, "stone", [chat("old")]), slot(4, "diamond")];
        const desired = [slot(0, "stone", [chat("new")]), slot(4, "diamond")];
        const result = plan(desired, baseline);
        expect(result.changes).toEqual([
            { slot: 0, desiredIndex: 0, setItem: false, setActions: true },
        ]);
    });

    it("writes actions when the observed list is only partially hydrated", () => {
        const observed = observedSlot(0, {
            type: "CONDITIONAL",
            matchAny: false,
        });
        observed.hydrated = false;
        const actionPlan = {
            desired: [],
            observed: [observed],
            diff: {
                desiredLength: 0,
                operations: [
                    {
                        kind: "delete",
                        entryId: 0,
                        fromIndex: 0,
                        baselineAction: observed.action,
                    },
                ],
            },
            phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 1 },
        } as ActionListPlan;
        const baseline = menuActionBaseline(
            actionPlan,
            undefined,
            "Shop",
            "slots[0].actions",
            4,
            true
        );

        const result = plan(
            [slot(4, "stone")],
            [{ slot: 4, itemKey: "stone", ...baseline }]
        );

        expect(result.changes).toEqual([
            { slot: 4, desiredIndex: 0, setItem: false, setActions: true },
        ]);
    });

    it("treats an undeclared live slot without a plan as an empty baseline", () => {
        expect(
            menuActionBaseline(null, undefined, "Shop", "slots[unknown].actions", 40, false)
        ).toEqual({ actions: [], actionsKnown: true });
    });

    it("identifies a missing menu action baseline with its menu and path", () => {
        expect(() =>
            menuActionBaseline(null, undefined, "Shop", "slots[2].actions", 7, true)
        ).toThrow(
            'Menu "Shop" has no usable baseline for slots[2].actions ' +
                "(Housing slot 7; unhydrated action indexes/types: " +
                "unavailable because no action plan exists)."
        );
    });

    it("marks both item and actions when both changed", () => {
        const baseline = [slot(2, "stone", [chat("old")])];
        const desired = [slot(2, "diamond", [chat("new")])];
        const result = plan(desired, baseline);
        expect(result.changes).toEqual([
            { slot: 2, desiredIndex: 0, setItem: true, setActions: true },
        ]);
    });

    it("adds a brand-new slot, syncing its actions only when present", () => {
        const baseline = [slot(0, "stone")];
        const desired = [
            slot(0, "stone"),
            slot(3, "diamond", [chat("hi")]),
            slot(5, "gold"),
        ];
        const result = plan(desired, baseline);
        expect(result.changes).toEqual([
            { slot: 3, desiredIndex: 1, setItem: true, setActions: true },
            { slot: 5, desiredIndex: 2, setItem: true, setActions: false },
        ]);
    });

    it("clears a slot present in the baseline but absent from the import", () => {
        const baseline = [slot(0, "stone"), slot(4, "diamond")];
        const desired = [slot(0, "stone")];
        const result = plan(desired, baseline);
        expect(result.changes).toEqual([]);
        expect(result.clears).toEqual([4]);
    });

    it("matches slots by number, not array position", () => {
        const baseline = [slot(8, "gold"), slot(0, "stone"), slot(4, "diamond")];
        const desired = [slot(0, "stone"), slot(4, "diamond"), slot(8, "gold")];
        const result = plan(desired, baseline, 1, 1);
        expect(result.changes).toEqual([]);
        expect(result.clears).toEqual([]);
    });

    it("reports size only when it differs", () => {
        expect(plan([], [], 2, 1).setSize).toBe(2);
        expect(plan([], [], 1, 1).setSize).toBeNull();
        expect(plan([], [], undefined, 1).setSize).toBeNull();
    });
});
