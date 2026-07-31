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
    test("application locks totals through reactivation, progress, and completion", () => {
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

    test("total lock keeps active-phase behavior without an applying event", () => {
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

    test("total lock combines measured observation with planned application work", () => {
        const s = emit([
            {
                kind: "sessionStarted",
                rows: [
                    { key: "small-menu", status: "queued", totalUnits: 90 },
                    { key: "function", status: "queued", totalUnits: 140 },
                    { key: "large-menu", status: "queued", totalUnits: 20 },
                ],
                initialTotalUnits: 250,
            },
            {
                kind: "importableStarted",
                key: "small-menu",
                type: "MENU",
                identity: "Small",
                setupUnits: 0,
                initialUnits: 90,
                rowIndex: 0,
                cached: null,
            },
            {
                kind: "progress",
                scope: { kind: "topLevel" },
                progress: {
                    phase: "hydrating",
                    completedUnits: 20,
                    totalUnits: 54,
                    phaseUnits: {
                        setup: 0,
                        reading: 12,
                        hydrating: 8,
                        applying: 34,
                    },
                    sync: { completedUnits: 1, totalUnits: 1, parent: null },
                },
            },
            {
                kind: "importableStarted",
                key: "function",
                type: "FUNCTION",
                identity: "Known",
                setupUnits: 0,
                initialUnits: 140,
                rowIndex: 1,
                cached: null,
            },
            {
                kind: "progress",
                scope: { kind: "topLevel" },
                progress: {
                    phase: "hydrating",
                    completedUnits: 40,
                    totalUnits: 93,
                    phaseUnits: {
                        setup: 0,
                        reading: 25,
                        hydrating: 15,
                        applying: 53,
                    },
                    sync: { completedUnits: 1, totalUnits: 1, parent: null },
                },
            },
            {
                kind: "importableStarted",
                key: "large-menu",
                type: "MENU",
                identity: "Large",
                setupUnits: 0,
                initialUnits: 20,
                rowIndex: 2,
                cached: null,
            },
            {
                kind: "progress",
                scope: { kind: "topLevel" },
                progress: {
                    phase: "hydrating",
                    completedUnits: 10,
                    totalUnits: 40,
                    phaseUnits: {
                        setup: 0,
                        reading: 6,
                        hydrating: 4,
                        applying: 30,
                    },
                    sync: { completedUnits: 1, totalUnits: 1, parent: null },
                },
            },
            {
                kind: "sessionTotalsLocked",
                plannedRows: [
                    { key: "small-menu", applicationUnits: 34 },
                    { key: "function", applicationUnits: 53 },
                    { key: "large-menu", applicationUnits: 30 },
                ],
            },
        ]);

        expect(s.progress.rows.map((row) => row.totalUnits)).toEqual([54, 93, 40]);
        expect(s.progress.totalUnits).toBe(54 + 93 + 40);
        expect(s.progress.active?.phase).toBe("hydrating");
        expect(s.progress.completedUnits).toBe(20 + 40 + 10);

        const afterApplicationProgress = reduce(s, {
            kind: "applicationProgress",
            completedUnits: 5,
            sync: { completedUnits: 1, totalUnits: 3, parent: null },
        });
        expect(afterApplicationProgress.progress.totalUnits).toBe(54 + 93 + 40);
        expect(
            afterApplicationProgress.progress.rows.map((row) => row.totalUnits)
        ).toEqual([54, 93, 40]);
        expect(afterApplicationProgress.progress.completedUnits).toBe(20 + 40 + 10 + 5);
    });

    test("total lock preserves a positive fractional application total", () => {
        let s = emit([
            {
                kind: "sessionStarted",
                rows: [{ key: "cached", status: "queued", totalUnits: 1 }],
                initialTotalUnits: 1,
            },
            {
                kind: "importableStarted",
                key: "cached",
                type: "FUNCTION",
                identity: "cached",
                setupUnits: 0,
                initialUnits: 1,
                rowIndex: 0,
                cached: null,
            },
            {
                kind: "sessionTotalsLocked",
                plannedRows: [{ key: "cached", applicationUnits: 0.25 }],
            },
        ]);

        expect(s.progress.totalUnits).toBe(0.25);
        s = reduce(s, {
            kind: "applicationProgress",
            completedUnits: 0.25,
            sync: null,
        });
        const beforeFinish = s.progress.completedUnits;
        s = reduce(s, {
            kind: "importableFinished",
            key: "cached",
            status: "skipped",
        });
        expect(s.progress.totalUnits).toBe(0.25);
        expect(s.progress.completedUnits).toBe(0.25);
        expect(s.progress.completedUnits).toBe(beforeFinish);
    });

    test("session application work is included and credited outside row totals", () => {
        let s = emit([
            {
                kind: "sessionStarted",
                rows: [{ key: "a", status: "queued", totalUnits: 10 }],
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
                kind: "sessionTotalsLocked",
                plannedRows: [{ key: "a", applicationUnits: 6 }],
                sessionApplicationUnits: 4,
            },
        ]);

        expect(s.progress.totalUnits).toBe(10);
        s = reduce(s, {
            kind: "sessionApplicationProgress",
            completedUnits: 4,
        });
        expect(s.progress.completedUnits).toBe(4);
        expect(s.progress.totalUnits).toBe(10);
    });

    test("successful finish does not manufacture unreported application work", () => {
        let s = emit([
            {
                kind: "sessionStarted",
                rows: [{ key: "a", status: "queued", totalUnits: 5 }],
                initialTotalUnits: 5,
            },
            {
                kind: "importableStarted",
                key: "a",
                type: "TEAM",
                identity: "a",
                setupUnits: 0,
                initialUnits: 5,
                rowIndex: 0,
                cached: null,
            },
            {
                kind: "sessionTotalsLocked",
                plannedRows: [{ key: "a", applicationUnits: 5 }],
            },
            {
                kind: "applicationProgress",
                completedUnits: 2,
                sync: null,
            },
        ]);

        s = reduce(s, {
            kind: "importableFinished",
            key: "a",
            status: "imported",
        });
        expect(s.progress.completedUnits).toBe(2);
        expect(s.progress.totalUnits).toBe(5);
    });

    test("failed row does not manufacture unfinished pre-lock work", () => {
        let s = emit([
            {
                kind: "sessionStarted",
                rows: [{ key: "a", status: "queued", totalUnits: 10 }],
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
                    phase: "reading",
                    completedUnits: 3,
                    totalUnits: 10,
                    phaseUnits: {
                        setup: 0,
                        reading: 3,
                        hydrating: 2,
                        applying: 5,
                    },
                    sync: { completedUnits: 3, totalUnits: 10, parent: null },
                },
            },
        ]);

        s = reduce(s, {
            kind: "importableFinished",
            key: "a",
            status: "failed",
        });
        expect(s.progress.completedUnits).toBe(3);
        expect(s.progress.totalUnits).toBe(10);
    });

    test("session finish preserves parked work after a failure", () => {
        let s = emit([
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
                    totalUnits: 10,
                    phaseUnits: {
                        setup: 0,
                        reading: 3,
                        hydrating: 2,
                        applying: 5,
                    },
                    sync: { completedUnits: 3, totalUnits: 10, parent: null },
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
                kind: "progress",
                scope: { kind: "topLevel" },
                progress: {
                    phase: "reading",
                    completedUnits: 2,
                    totalUnits: 10,
                    phaseUnits: {
                        setup: 0,
                        reading: 2,
                        hydrating: 3,
                        applying: 5,
                    },
                    sync: { completedUnits: 2, totalUnits: 10, parent: null },
                },
            },
            {
                kind: "importableFinished",
                key: "b",
                status: "failed",
            },
        ]);
        const beforeFinish = s.progress;

        s = reduce(s, { kind: "sessionFinished" });
        expect(s.progress.completedUnits).toBe(beforeFinish.completedUnits);
        expect(s.progress.totalUnits).toBe(beforeFinish.totalUnits);
        expect(s.progress.parked).toEqual({});
    });

    test("structured total lock is single-shot and ignores legacy progress", () => {
        let s = emit([
            {
                kind: "sessionStarted",
                rows: [{ key: "a", status: "queued", totalUnits: 10 }],
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
                kind: "sessionTotalsLocked",
                plannedRows: [{ key: "a", applicationUnits: 4 }],
            },
        ]);
        const locked = s.progress;

        s = reduce(s, {
            kind: "sessionTotalsLocked",
            plannedRows: [{ key: "a", applicationUnits: 99 }],
        });
        s = reduce(s, {
            kind: "progress",
            scope: { kind: "topLevel" },
            progress: {
                phase: "hydrating",
                completedUnits: 50,
                totalUnits: 100,
                phaseUnits: {
                    setup: 0,
                    reading: 25,
                    hydrating: 25,
                    applying: 50,
                },
                sync: { completedUnits: 50, totalUnits: 100, parent: null },
            },
        });

        expect(s.progress).toEqual(locked);
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

    test("trusted hydration completion stays reading while active and turns purple when parked", () => {
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
                    totalUnits: 3,
                    phaseUnits: { setup: 0, reading: 3, hydrating: 0, applying: 0 },
                    sync: { completedUnits: 1, totalUnits: 1, parent: null },
                    measuredTotalUnits: true,
                },
            },
            { kind: "importableHydrationCompleted", key: "a" },
        ]);

        expect(s.progress.active?.phase).toBe("reading");

        s = reduce(s, {
            kind: "importableStarted",
            key: "b",
            type: "FUNCTION",
            identity: "b",
            setupUnits: 0,
            initialUnits: 10,
            rowIndex: 1,
            cached: null,
        });

        expect(s.progress.parked.a.phase).toBe("hydrating");
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
