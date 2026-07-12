import { describe, expect, test } from "vitest";

import { firstTreeRowEndingAtOrAfter } from "../src/gui/left-panel/projects/tree";

function linearReference(rowEnds: number[], y: number): number {
    for (let i = 0; i < rowEnds.length; i++) {
        if (rowEnds[i] >= y) return i;
    }
    return rowEnds.length;
}

describe("firstTreeRowEndingAtOrAfter", () => {
    test("preserves the old inclusive viewport boundary", () => {
        const ends = [19, 38, 57, 76];
        expect(firstTreeRowEndingAtOrAfter(ends, 0)).toBe(0);
        expect(firstTreeRowEndingAtOrAfter(ends, 19)).toBe(0);
        expect(firstTreeRowEndingAtOrAfter(ends, 20)).toBe(1);
        expect(firstTreeRowEndingAtOrAfter(ends, 76)).toBe(3);
        expect(firstTreeRowEndingAtOrAfter(ends, 77)).toBe(4);
    });

    test("matches the replaced linear scan", () => {
        const ends: number[] = [];
        let total = 0;
        for (let i = 0; i < 500; i++) {
            total += 12 + (i % 9);
            ends.push(total);
        }
        for (let y = 0; y <= total + 2; y += 7) {
            expect(firstTreeRowEndingAtOrAfter(ends, y)).toBe(linearReference(ends, y));
        }
    });
});
