import { describe, expect, test } from "vitest";
import type { Condition } from "htsw/types";

import {
    baselineConditionListFromConditions,
    currentConditionListFromSlots,
    diffConditionList,
} from "../src/housingSync/actions/conditions/diff";
import type { ConditionListOperation } from "../src/housingSync/actions/diff/types";
import type { ObservedConditionSlot } from "../src/housingSync/observedActions";

function obs(index: number, condition: Condition | null): ObservedConditionSlot {
    return { index, slotId: index, slot: null as never, condition };
}

function sneaking(over: Partial<Condition> = {}): Condition {
    return { type: "IS_SNEAKING", ...over } as Condition;
}

function flying(over: Partial<Condition> = {}): Condition {
    return { type: "IS_FLYING", ...over } as Condition;
}

function health(amount: string, over: Partial<Condition> = {}): Condition {
    return {
        type: "COMPARE_HEALTH",
        op: "Greater Than",
        amount,
        ...over,
    } as Condition;
}

function requireItem(itemName: string, over: Partial<Condition> = {}): Condition {
    return {
        type: "REQUIRE_ITEM",
        itemName,
        ...over,
    } as Condition;
}

function ops(
    observed: ObservedConditionSlot[],
    desired: Condition[]
): ConditionListOperation[] {
    return diffConditionList(currentConditionListFromSlots(observed), desired).operations;
}

function baselineOps(
    observed: Array<Condition | null>,
    desired: Condition[]
): ConditionListOperation[] {
    return diffConditionList(baselineConditionListFromConditions(observed), desired)
        .operations;
}

function kindCounts(opsList: ConditionListOperation[]): Record<string, number> {
    const out: Record<string, number> = { delete: 0, edit: 0, add: 0 };
    for (const op of opsList) out[op.kind]++;
    return out;
}

describe("diffConditionList", () => {
    test("empty and identical lists produce no ops", () => {
        expect(ops([], [])).toEqual([]);

        const a = sneaking();
        const b = health("10");
        expect(ops([obs(0, a), obs(1, b)], [a, b])).toEqual([]);
    });

    test("adds and deletes conditions", () => {
        expect(kindCounts(ops([], [sneaking()]))).toMatchObject({ add: 1 });
        expect(kindCounts(ops([obs(0, sneaking())], []))).toMatchObject({
            delete: 1,
        });
    });

    test("null observed entries become deletes", () => {
        expect(kindCounts(ops([obs(0, null)], []))).toMatchObject({ delete: 1 });
    });

    test("note-only changes are flagged as noteOnly", () => {
        const result = ops(
            [obs(0, sneaking({ note: "old" }))],
            [sneaking({ note: "new" })]
        );
        expect(kindCounts(result)).toMatchObject({ edit: 1 });
        expect(
            (result[0] as Extract<ConditionListOperation, { kind: "edit" }>).noteOnly
        ).toBe(true);
    });

    test("same-type field changes are edits", () => {
        const result = ops([obs(0, health("10"))], [health("15")]);
        expect(kindCounts(result)).toMatchObject({ edit: 1, add: 0, delete: 0 });
        expect(
            (result[0] as Extract<ConditionListOperation, { kind: "edit" }>).noteOnly
        ).toBe(false);
    });

    test("inverted changes are edits", () => {
        const result = ops(
            [obs(0, health("10", { inverted: false }))],
            [health("10", { inverted: true })]
        );
        expect(kindCounts(result)).toMatchObject({ edit: 1, add: 0, delete: 0 });
    });

    test("different condition types become delete plus add", () => {
        const result = ops([obs(0, sneaking())], [flying()]);
        expect(kindCounts(result)).toMatchObject({ delete: 1, add: 1, edit: 0 });
    });

    test("exact duplicate matches do not produce edits", () => {
        const a = requireItem("key");
        const result = ops([obs(0, a), obs(1, a)], [a, a]);
        expect(result).toEqual([]);
    });

    test("baseline condition arrays use positional entry ids", () => {
        const result = baselineOps([sneaking()], [sneaking({ note: "new" })]);
        expect(result[0]).toMatchObject({ kind: "edit", entryId: 0 });
    });
});
