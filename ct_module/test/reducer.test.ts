import { describe, expect, test } from "vitest";

import { initialReducerState, reduce } from "../src/housingSync/progress/reducer";
import type { SyncEvent } from "../src/housingSync/syncEvents";
import { isTaskTotalLocked } from "../src/housingSync/progress/types";

const baseRow = { totalUnits: 10 };

function emit(events: SyncEvent[]) {
    let s = initialReducerState();
    for (const e of events) s = reduce(s, e);
    return s;
}

describe("progress reducer", () => {
    test("planned parked rows refine the session total down and up immediately", () => {
        let s = emit([
            {
                kind: "sessionStarted",
                rows: [
                    { key: "menu-low", status: "queued", totalUnits: 50 },
                    { key: "menu-high", status: "queued", totalUnits: 20 },
                    { key: "active", status: "queued", totalUnits: 10 },
                ],
                initialTotalUnits: 80,
            },
            {
                kind: "importableStarted",
                key: "menu-low",
                type: "MENU",
                identity: "low",
                setupUnits: 2,
                initialUnits: 50,
                rowIndex: 0,
                cached: null,
            },
            {
                kind: "progress",
                scope: { kind: "topLevel" },
                progress: {
                    phase: "hydrating",
                    completedUnits: 3,
                    totalUnits: 3,
                    phaseUnits: {
                        setup: 0,
                        reading: 3,
                        hydrating: 0,
                        applying: 0,
                    },
                    sync: { completedUnits: 0, totalUnits: 0, parent: null },
                },
            },
            {
                kind: "importableStarted",
                key: "menu-high",
                type: "MENU",
                identity: "high",
                setupUnits: 2,
                initialUnits: 20,
                rowIndex: 1,
                cached: null,
            },
            {
                kind: "progress",
                scope: { kind: "topLevel" },
                progress: {
                    phase: "hydrating",
                    completedUnits: 3,
                    totalUnits: 3,
                    phaseUnits: {
                        setup: 0,
                        reading: 3,
                        hydrating: 0,
                        applying: 0,
                    },
                    sync: { completedUnits: 0, totalUnits: 0, parent: null },
                },
            },
            {
                kind: "importableStarted",
                key: "active",
                type: "FUNCTION",
                identity: "active",
                setupUnits: 0,
                initialUnits: 10,
                rowIndex: 2,
                cached: null,
            },
        ]);

        expect(s.progress.totalUnits).toBe(86);

        s = reduce(s, {
            kind: "importableApplyUnitsRefined",
            key: "menu-low",
            applyingUnits: 5,
        });
        expect(s.progress.totalUnits).toBe(43);
        expect(s.progress.rows[0].totalUnits).toBe(10);

        s = reduce(s, {
            kind: "importableApplyUnitsRefined",
            key: "menu-high",
            applyingUnits: 25,
        });
        expect(s.progress.totalUnits).toBe(50);
        expect(s.progress.rows[1].totalUnits).toBe(30);
    });

    test("apply pass locks totals through reactivation, progress, and completion", () => {
        let s = emit([
            {
                kind: "sessionStarted",
                rows: [
                    { key: "a", status: "queued", ...baseRow },
                    { key: "b", status: "queued", ...baseRow },
                ],
                initialTotalUnits: 20,
            },
            {
                kind: "importableStarted",
                key: "a",
                type: "FUNCTION",
                identity: "a",
                setupUnits: 2,
                initialUnits: 10,
                rowIndex: 0,
                cached: null,
            },
            {
                kind: "importableStarted",
                key: "b",
                type: "FUNCTION",
                identity: "b",
                setupUnits: 2,
                initialUnits: 10,
                rowIndex: 1,
                cached: null,
            },
            { kind: "sessionTotalsLocked" },
            {
                kind: "importableReactivated",
                key: "a",
                rowIndex: 0,
                phase: "hydrating",
            },
        ]);

        expect(s.progress.totalsLocked).toBe(true);
        expect(isTaskTotalLocked(s.progress)).toBe(true);

        s = reduce(s, { kind: "setupStep", label: "setup", completed: 1, total: 1 });
        expect(s.progress.active?.phase).toBe("setup");
        expect(isTaskTotalLocked(s.progress)).toBe(true);

        s = reduce(s, {
            kind: "progress",
            scope: { kind: "topLevel" },
            progress: {
                phase: "applying",
                completedUnits: 8,
                totalUnits: 8,
                phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 8 },
                sync: { completedUnits: 8, totalUnits: 8, parent: null },
            },
        });
        s = reduce(s, { kind: "importableFinished", key: "a", status: "imported" });

        expect(s.progress.totalsLocked).toBe(true);
    });

    test("total lock keeps active-phase behavior without an apply-pass event", () => {
        const hydrating = emit([
            {
                kind: "sessionStarted",
                rows: [{ key: "a", status: "queued", ...baseRow }],
                initialTotalUnits: 10,
            },
            {
                kind: "importableStarted",
                key: "a",
                type: "FUNCTION",
                identity: "a",
                setupUnits: 0,
                initialUnits: 10,
                rowIndex: 0,
                cached: null,
            },
            {
                kind: "progress",
                scope: { kind: "topLevel" },
                progress: {
                    phase: "hydrating",
                    completedUnits: 5,
                    totalUnits: 10,
                    phaseUnits: { setup: 0, reading: 5, hydrating: 5, applying: 0 },
                    sync: { completedUnits: 5, totalUnits: 10, parent: null },
                },
            },
        ]);

        expect(hydrating.progress.totalsLocked).toBe(false);
        expect(isTaskTotalLocked(hydrating.progress)).toBe(false);

        const applying = reduce(hydrating, {
            kind: "progress",
            scope: { kind: "topLevel" },
            progress: {
                phase: "applying",
                completedUnits: 5,
                totalUnits: 10,
                phaseUnits: { setup: 0, reading: 5, hydrating: 0, applying: 5 },
                sync: { completedUnits: 0, totalUnits: 5, parent: null },
            },
        });

        expect(applying.progress.totalsLocked).toBe(false);
        expect(isTaskTotalLocked(applying.progress)).toBe(true);
    });

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

    test("menuSlotStarted sets the active slot focus and later slots replace it", () => {
        const s = emit([
            {
                kind: "sessionStarted",
                rows: [{ key: "m", status: "queued", ...baseRow }],
                initialTotalUnits: 10,
            },
            {
                kind: "importableStarted",
                key: "m",
                type: "MENU",
                identity: "Shop",
                setupUnits: 0,
                initialUnits: 10,
                rowIndex: 0,
                cached: null,
            },
        ]);
        // Fresh importable has no slot focus.
        expect(s.progress.active!.currentSlot ?? null).toBeNull();

        const s2 = reduce(s, {
            kind: "menuSlotStarted",
            slot: 13,
            label: "Diamond Sword",
            index: 2,
            count: 6,
        });
        expect(s2.progress.active!.currentSlot).toEqual({
            slot: 13,
            label: "Diamond Sword",
            index: 2,
            count: 6,
        });

        const s3 = reduce(s2, {
            kind: "menuSlotStarted",
            slot: 20,
            label: null,
            index: 3,
            count: 6,
        });
        expect(s3.progress.active!.currentSlot).toEqual({
            slot: 20,
            label: null,
            index: 3,
            count: 6,
        });
    });

    test("knowledge source events retain the importable's cache and house mix", () => {
        const s = emit([
            {
                kind: "sessionStarted",
                rows: [{ key: "m", status: "queued", ...baseRow }],
                initialTotalUnits: 10,
            },
            {
                kind: "importableStarted",
                key: "m",
                type: "MENU",
                identity: "Shop",
                setupUnits: 0,
                initialUnits: 10,
                rowIndex: 0,
                cached: null,
            },
            {
                kind: "knowledgeSourceUsed",
                source: "house",
                reason: "shell-read",
                lockStatus: "matched",
            },
            {
                kind: "knowledgeSourceUsed",
                source: "cache",
                reason: "cached-list",
                lockStatus: "matched",
            },
        ]);

        expect(s.progress.active?.knowledge).toEqual({
            usedCache: true,
            usedHouse: true,
            usedKnownState: false,
            currentSource: "cache",
            currentReason: "cached-list",
            lockStatus: "matched",
        });
    });

    test("menu slot action progress uses nested-list accounting without an action path", () => {
        const s = emit([
            {
                kind: "sessionStarted",
                rows: [{ key: "m", status: "queued", ...baseRow }],
                initialTotalUnits: 10,
            },
            {
                kind: "importableStarted",
                key: "m",
                type: "MENU",
                identity: "Shop",
                setupUnits: 0,
                initialUnits: 10,
                rowIndex: 0,
                cached: null,
            },
            {
                kind: "progress",
                scope: {
                    kind: "menuSlotActions",
                    baselineApplyUnits: 2,
                    parentSync: { completedUnits: 1, totalUnits: 3 },
                },
                progress: {
                    phase: "applying",
                    completedUnits: 3,
                    totalUnits: 5,
                    phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 5 },
                    sync: { completedUnits: 3, totalUnits: 5, parent: null },
                },
            },
        ]);

        expect(s.progress.active!.completedUnits).toBe(5);
        expect(s.progress.active!.sync).toEqual({
            completedUnits: 3,
            totalUnits: 5,
            parent: { completedUnits: 1, totalUnits: 3 },
        });
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

    test("parking during reading preserves the pending hydrate estimate", () => {
        const s = emit([
            {
                kind: "sessionStarted",
                rows: [
                    { key: "a", status: "queued", ...baseRow },
                    { key: "b", status: "queued", ...baseRow },
                ],
                initialTotalUnits: 20,
            },
            {
                kind: "importableStarted",
                key: "a",
                type: "FUNCTION",
                identity: "a",
                setupUnits: 2,
                initialUnits: 10,
                rowIndex: 0,
                cached: null,
            },
            {
                kind: "progress",
                scope: { kind: "topLevel" },
                progress: {
                    phase: "reading",
                    completedUnits: 3,
                    totalUnits: 10,
                    phaseUnits: { setup: 0, reading: 3, hydrating: 7, applying: 0 },
                    sync: { completedUnits: 0, totalUnits: 0, parent: null },
                    preserveApplyingEstimate: false,
                },
            },
            {
                kind: "importableStarted",
                key: "b",
                type: "FUNCTION",
                identity: "b",
                setupUnits: 0,
                initialUnits: 10,
                rowIndex: 1,
                cached: null,
            },
        ]);

        expect(s.progress.parked.a.phaseUnits).toEqual({
            setup: 2,
            reading: 3,
            hydrating: 7,
            applying: 0,
        });
        expect(s.progress.parked.a.totalUnits).toBe(12);
    });

    test("parking after hydrating keeps the read/hydrate split", () => {
        const s = emit([
            {
                kind: "sessionStarted",
                rows: [
                    { key: "a", status: "queued", ...baseRow },
                    { key: "b", status: "queued", ...baseRow },
                ],
                initialTotalUnits: 20,
            },
            {
                kind: "importableStarted",
                key: "a",
                type: "FUNCTION",
                identity: "a",
                setupUnits: 2,
                initialUnits: 10,
                rowIndex: 0,
                cached: null,
            },
            {
                kind: "progress",
                scope: { kind: "topLevel" },
                progress: {
                    phase: "hydrating",
                    completedUnits: 8,
                    totalUnits: 8,
                    phaseUnits: { setup: 0, reading: 3, hydrating: 5, applying: 0 },
                    sync: { completedUnits: 0, totalUnits: 0, parent: null },
                    preserveApplyingEstimate: false,
                },
            },
            {
                kind: "importableStarted",
                key: "b",
                type: "FUNCTION",
                identity: "b",
                setupUnits: 0,
                initialUnits: 10,
                rowIndex: 1,
                cached: null,
            },
        ]);

        expect(s.progress.parked.a.phaseUnits).toEqual({
            setup: 2,
            reading: 3,
            hydrating: 5,
            applying: 0,
        });
        expect(s.progress.parked.a.totalUnits).toBe(10);
    });

    test("reactivating an export row enters hydration immediately", () => {
        const s = emit([
            {
                kind: "sessionStarted",
                rows: [
                    { key: "a", status: "queued", ...baseRow },
                    { key: "b", status: "queued", ...baseRow },
                ],
                initialTotalUnits: 20,
            },
            {
                kind: "importableStarted",
                key: "a",
                type: "FUNCTION",
                identity: "a",
                setupUnits: 0,
                initialUnits: 10,
                rowIndex: 0,
                cached: null,
            },
            {
                kind: "progress",
                scope: { kind: "topLevel" },
                progress: {
                    phase: "reading",
                    completedUnits: 3,
                    totalUnits: 8,
                    phaseUnits: { setup: 0, reading: 3, hydrating: 5, applying: 0 },
                    sync: { completedUnits: 3, totalUnits: 8, parent: null },
                    preserveApplyingEstimate: false,
                },
            },
            {
                kind: "importableStarted",
                key: "b",
                type: "FUNCTION",
                identity: "b",
                setupUnits: 0,
                initialUnits: 10,
                rowIndex: 1,
                cached: null,
            },
            {
                kind: "importableReactivated",
                key: "a",
                rowIndex: 0,
                phase: "hydrating",
            },
        ]);

        expect(s.progress.active?.key).toBe("a");
        expect(s.progress.active?.phase).toBe("hydrating");
        expect(s.progress.active?.completedUnits).toBe(3);
        expect(s.progress.active?.phaseUnits).toEqual({
            setup: 0,
            reading: 3,
            hydrating: 5,
            applying: 0,
        });
    });
});
