import { afterEach, describe, expect, it, vi } from "vitest";

const logged = vi.hoisted(() => [] as string[]);

vi.mock("../src/gui/lib/debugLog", () => ({
    debugLog: (line: string) => logged.push(line),
}));

import {
    activeSpanPath,
    clearSlowSpans,
    getSlowSpans,
    setSpanThreshold,
    span,
} from "../src/perf/spans";

let now = 0;

afterEach(() => {
    setSpanThreshold(null);
    clearSlowSpans();
    logged.length = 0;
    vi.restoreAllMocks();
});

function advance(ms: number): void {
    now += ms;
}

describe("perf spans", () => {
    it("records nothing while off", () => {
        vi.spyOn(Date, "now").mockImplementation(() => now);
        expect(span("tick", () => (advance(500), 7))).toBe(7);
        expect(getSlowSpans()).toEqual([]);
        expect(logged).toEqual([]);
    });

    it("logs slow spans innermost first, with their nesting", () => {
        vi.spyOn(Date, "now").mockImplementation(() => now);
        setSpanThreshold(100);
        span("overlay.tick", () => {
            span("tick.cacheWarm", () => advance(10));
            span("tick.pendingParses", () => {
                expect(activeSpanPath()).toBe("overlay.tick > tick.pendingParses");
                advance(150);
            });
        });

        expect(getSlowSpans().map((slow) => [slow.ms, slow.path])).toEqual([
            [150, "overlay.tick > tick.pendingParses"],
            [160, "overlay.tick"],
        ]);
        expect(activeSpanPath()).toBe("");
    });

    it("unwinds when the work throws", () => {
        setSpanThreshold(100);
        expect(() =>
            span("outer", () =>
                span("inner", () => {
                    throw new Error("boom");
                })
            )
        ).toThrow("boom");
        expect(activeSpanPath()).toBe("");
    });
});
