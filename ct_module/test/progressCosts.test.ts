import { describe, expect, test } from "vitest";
import type { Action, Condition, ImportableFunction, ImportableMenu } from "htsw/types";

import {
    actionOperationApplyUnits,
    conditionOperationUnits,
    estimateImportableCost,
    estimateImportableReadUnits,
    exactHydrationPlanUnits,
    hydrationEntryUnits,
    COST,
} from "../src/housingSync/progress/costs";
import type {
    ActionListOperation,
    ConditionListOperation,
} from "../src/housingSync/types";

import { conditional, message, observedSlot } from "./utils";

describe("progress cost estimates", () => {
    test("condition note-only edits charge one note edit", () => {
        const baseline = { type: "IS_SNEAKING", note: "old" } as Condition;
        const desired = { type: "IS_SNEAKING", note: "new" } as Condition;
        const op: Extract<ConditionListOperation, { kind: "edit" }> = {
            kind: "edit",
            entryId: 0,
            baselineCondition: baseline,
            desired,
            noteOnly: true,
        };

        expect(conditionOperationUnits(op)).toBe(COST.chatInput);
    });

    test("action note-only edits charge one note edit", () => {
        const op: Extract<ActionListOperation, { kind: "edit" }> = {
            kind: "edit",
            entryId: 0,
            fromIndex: 0,
            desiredIndex: 0,
            baselineAction: message("hi", { note: "old" }),
            desired: message("hi", { note: "new" }),
            noteOnly: true,
            noteDiffers: true,
            childListDiffs: [],
        };

        expect(actionOperationApplyUnits(op, () => 0, 1)).toBe(COST.chatInput);
    });

    test("menu estimate prices each slot as an editor round-trip plus its list", () => {
        const menuWith = (actions: Action[]): ImportableMenu => ({
            type: "MENU",
            name: "m",
            slots: [{ slot: 0, nbt: null as never, actions }],
        });

        const emptySlot = estimateImportableCost(menuWith([]));
        // Entering and leaving a slot's action editor costs two menu waits —
        // far more than the single click the old estimate charged.
        expect(emptySlot).toBeGreaterThanOrEqual(
            COST.menuClickWait + COST.goBackWait
        );

        const withChildren = estimateImportableCost(
            menuWith([conditional({ ifActions: [message("a"), message("b")] })])
        );
        expect(withChildren).toBeGreaterThan(emptySlot);
    });

    test("function read estimate prices its list walk without apply work", () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "f",
            actions: [conditional({ ifActions: [message("a")] })],
        };

        expect(estimateImportableReadUnits(importable)).toBeCloseTo(
            COST.commandMenuWait +
                COST.menuClickWait +
                (COST.menuClickWait + COST.goBackWait +
                    COST.menuClickWait + COST.goBackWait) +
                COST.goBackWait +
                COST.menuClickWait +
                COST.goBackWait +
                COST.cacheWrite
        );
    });

    test("exact hydration plan pricing excludes speculative child-row scalar reads", () => {
        const entry = {
            ...observedSlot(0, conditional()),
            childListSummaries: { ifActions: ["MESSAGE"] },
        };
        const work = {
        childListsToRead: new Set(["ifActions"] as const),
            scalarFieldsToRead: [],
            itemFieldsToCapture: [],
        };
        const plan = new Map([[entry, work]]);

        expect(exactHydrationPlanUnits(plan)).toBeCloseTo(
            COST.menuClickWait * 2 + COST.goBackWait * 2
        );
        expect(hydrationEntryUnits(entry, work)).toBeGreaterThan(
            exactHydrationPlanUnits(plan)
        );
    });
});
