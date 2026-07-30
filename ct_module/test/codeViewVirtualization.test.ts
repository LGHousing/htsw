import { describe, expect, test } from "vitest";

import { CodeView, firstEntryIntersecting } from "../src/gui/code-view/codeView";
import { getScrollState, markUserScroll, setScrollOffset } from "../src/gui/lib/layout";

// Mirrors the replaced linear scan: skip while an entry's end row is at or
// before the first visible row, stop at the first entry that reaches past it.
function linearReference(entryRowEnd: number[], row: number): number {
    for (let i = 0; i < entryRowEnd.length; i++) {
        if (entryRowEnd[i] > row) return i;
    }
    return entryRowEnd.length;
}

describe("firstEntryIntersecting", () => {
    test("empty list", () => {
        expect(firstEntryIntersecting([], 0)).toBe(0);
    });

    test("single-row entries", () => {
        const ends = [1, 2, 3, 4, 5];
        expect(firstEntryIntersecting(ends, 0)).toBe(0);
        expect(firstEntryIntersecting(ends, 1)).toBe(1);
        expect(firstEntryIntersecting(ends, 4)).toBe(4);
        expect(firstEntryIntersecting(ends, 5)).toBe(5);
        expect(firstEntryIntersecting(ends, 99)).toBe(5);
    });

    test("wrapped entries spanning several rows", () => {
        // entry row ranges: [0,3) [3,4) [4,10) [10,12)
        const ends = [3, 4, 10, 12];
        expect(firstEntryIntersecting(ends, 0)).toBe(0);
        expect(firstEntryIntersecting(ends, 2)).toBe(0);
        expect(firstEntryIntersecting(ends, 3)).toBe(1);
        expect(firstEntryIntersecting(ends, 5)).toBe(2);
        expect(firstEntryIntersecting(ends, 11)).toBe(3);
        expect(firstEntryIntersecting(ends, 12)).toBe(4);
    });

    test("zero-row entries are skipped like the linear scan skipped them", () => {
        // second entry contributes no rows (end === previous end)
        const ends = [2, 2, 5];
        expect(firstEntryIntersecting(ends, 2)).toBe(2);
        expect(firstEntryIntersecting(ends, 1)).toBe(0);
    });

    test("matches the linear reference on a sweep", () => {
        const ends: number[] = [];
        let total = 0;
        for (let i = 0; i < 100; i++) {
            total += i % 4; // includes zero-row entries
            ends.push(total);
        }
        for (let row = 0; row <= total + 2; row++) {
            expect(firstEntryIntersecting(ends, row)).toBe(linearReference(ends, row));
        }
    });
});

describe("CodeView identity", () => {
    test("resets scroll state only when the displayed view changes", () => {
        const scrollId = "code-view-identity-test";
        const props = {
            scrollId,
            viewIdentity: "first",
            lines: [],
            lineDecorator: {
                decorateLine: () => ({}),
                focusedLineId: () => null,
                modelKey: () => null,
            },
        };
        CodeView(props);

        const state = getScrollState(scrollId);
        state.contentLength = 500;
        state.viewportRect = { x: 0, y: 0, w: 100, h: 100 };
        setScrollOffset(scrollId, 200);
        markUserScroll(scrollId);

        CodeView(props);
        expect(state.offset).toBe(200);
        expect(state.target).toBe(200);
        expect(state.userOverridden).toBe(true);

        CodeView({ ...props, viewIdentity: "second" });
        expect(state.offset).toBe(0);
        expect(state.target).toBe(0);
        expect(state.userOverridden).toBe(false);
    });
});
