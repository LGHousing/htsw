import { describe, expect, it } from "vitest";
import type { Comparison } from "../src/types";
import { VarDouble, VarLong } from "../src/runtime/vars";

const comparisons: Comparison[] = [
    "Equal",
    "Less Than",
    "Less Than or Equal",
    "Greater Than",
    "Greater Than or Equal",
];

describe("numeric variable comparisons", () => {
    it.each([
        [VarLong.fromNumber(5), new VarDouble(5.5), [false, true, true, false, false]],
        [new VarDouble(5.5), VarLong.fromNumber(5), [false, false, false, true, true]],
        [VarLong.fromNumber(5), new VarDouble(5), [true, false, true, false, true]],
        [new VarDouble(5), VarLong.fromNumber(5), [true, false, true, false, true]],
    ])("compares %s and %s consistently", (left, right, expected) => {
        expect(comparisons.map(comparison => left.cmpOp(right, comparison))).toEqual(expected);
    });
});
