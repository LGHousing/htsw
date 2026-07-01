import { describe, expect, test } from "vitest";

import {
    initialReducerState,
    reduce,
} from "../src/housingSync/progress/reducer";
import type { SyncEvent } from "../src/housingSync/syncEvents";

const baseRow = { totalUnits: 10 };

function emit(events: SyncEvent[]) {
    let s = initialReducerState();
    for (const e of events) s = reduce(s, e);
    return s;
}

describe("progress reducer", () => {
    test("sessionStarted seeds rows + total", () => {
        const s = emit([
            {
                kind: "sessionStarted",
                rows: [
                    { key: "a", status: "queued", ...baseRow },
                    { key: "b", status: "queued", ...baseRow },
                ],
                initialTotalUnits: 20,
            },
        ]);
        expect(s.progress.rows).toHaveLength(2);
        expect(s.progress.totalUnits).toBe(20);
        expect(s.progress.active).toBeNull();
    });

    test("importableStarted sets active with setup units", () => {
        const s = emit([
            {
                kind: "sessionStarted",
                rows: [{ key: "a", status: "queued", ...baseRow }],
                initialTotalUnits: 10,
            },
            {
                kind: "importableStarted",
                key: "a",
                type: "FUNCTION",
                identity: "foo",
                setupUnits: 3,
                initialUnits: 10,
                rowIndex: 0,
                cached: null,
            },
        ]);
        expect(s.progress.active).not.toBeNull();
        expect(s.progress.active!.phase).toBe("setup");
        expect(s.progress.active!.phaseUnits).toEqual({
            setup: 3,
            reading: 0,
            hydrating: 0,
            applying: 7,
        });
        expect(s.progress.rows[0].status).toBe("current");
    });

    test("setupStep credits proportional setup progress", () => {
        const s = emit([
            {
                kind: "sessionStarted",
                rows: [{ key: "a", status: "queued", ...baseRow }],
                initialTotalUnits: 10,
            },
            {
                kind: "importableStarted",
                key: "a",
                type: "FUNCTION",
                identity: "foo",
                setupUnits: 4,
                initialUnits: 10,
                rowIndex: 0,
                cached: null,
            },
            { kind: "setupStep", label: "x", completed: 1, total: 4 },
        ]);
        // 1/4 of 4 setupUnits = 1 unit credited
        expect(s.progress.active!.completedUnits).toBe(1);
    });

    test("progress event is monotonic and clamped", () => {
        const s = emit([
            {
                kind: "sessionStarted",
                rows: [{ key: "a", status: "queued", totalUnits: 10 }],
                initialTotalUnits: 10,
            },
            {
                kind: "importableStarted",
                key: "a",
                type: "FUNCTION",
                identity: "foo",
                setupUnits: 2,
                initialUnits: 10,
                rowIndex: 0,
                cached: null,
            },
            {
                kind: "progress",
                scope: { kind: "topLevel" },
                progress: {
                    phase: "applying",
                    completedUnits: 5,
                    totalUnits: 8,
                    phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 8 },
                    sync: { completedUnits: 3, totalUnits: 8, parent: null },
                },
            },
            // Regression: a later event reports a smaller completedUnits.
            {
                kind: "progress",
                scope: { kind: "topLevel" },
                progress: {
                    phase: "applying",
                    completedUnits: 4,
                    totalUnits: 8,
                    phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 8 },
                    sync: { completedUnits: 2, totalUnits: 8, parent: null },
                },
            },
        ]);
        // setup(2) + max(5,4) = 7 — guard kept the higher value.
        expect(s.progress.active!.completedUnits).toBe(7);
    });

    test("importableFinished folds into session totals + clears active", () => {
        const s = emit([
            {
                kind: "sessionStarted",
                rows: [
                    { key: "a", status: "queued", totalUnits: 10 },
                    { key: "b", status: "queued", totalUnits: 10 },
                ],
                initialTotalUnits: 20,
            },
            {
                kind: "importableStarted",
                key: "a",
                type: "FUNCTION",
                identity: "foo",
                setupUnits: 0,
                initialUnits: 10,
                rowIndex: 0,
                cached: null,
            },
            { kind: "importableFinished", key: "a", status: "imported" },
        ]);
        expect(s.progress.active).toBeNull();
        expect(s.progress.rows[0].status).toBe("imported");
        expect(s.progress.completedUnits).toBe(10);
        expect(s.progress.totalUnits).toBe(20);
    });
});
