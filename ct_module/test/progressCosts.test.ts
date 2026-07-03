import { describe, expect, test } from "vitest";
import type { Action, Condition, ImportableMenu } from "htsw/types";

import {
    actionOperationApplyUnits,
    conditionOperationUnits,
    estimateImportableCost,
    COST,
} from "../src/housingSync/progress/costs";
import type {
    ActionListOperation,
    ConditionListOperation,
} from "../src/housingSync/types";

import { conditional, message } from "./utils";

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
});
