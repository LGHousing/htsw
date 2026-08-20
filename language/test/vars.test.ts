import { describe, expect, it } from "vitest";
import type { Comparison } from "../src/types";
import { VarDouble, VarLong, formatNumber } from "../src/runtime/vars";

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

describe("formatNumber", () => {
    it.each([
        ["4.9999", "5.0"],
        ["-4.9999", "-5.0"],
        ["999.9996", "1,000.0"],
        ["4.1235", "4.124"],
        ["4.0004", "4.0004"],
        ["4.5", "4.5"],
        ["1234.5", "1,234.5"],
        ["6.0000", "6.0"],
        ["12345", "12,345"],
    ])("formats %s as %s", (input, expected) => {
        expect(formatNumber(input)).toBe(expected);
    });
});
