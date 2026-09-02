import { describe, expect, test } from "vitest";

import { initialReducerState, reduce } from "../src/housingSync/progress/reducer";
import type { SyncEvent } from "../src/housingSync/syncEvents";
import { isTaskTotalEtaReady } from "../src/housingSync/progress/types";

function emit(events: SyncEvent[]) {
    let s = initialReducerState();
    for (const e of events) s = reduce(s, e);
    return s;
}

function started(): SyncEvent[] {
    return [
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
    ];
}

function hydrating(): SyncEvent {
    return {
        kind: "progress",
        scope: { kind: "topLevel" },
        progress: {
            phase: "hydrating",
            completedUnits: 5,
            totalUnits: 10,
            phaseUnits: { setup: 0, reading: 5, hydrating: 5, applying: 0 },
            sync: { completedUnits: 5, totalUnits: 10, parent: null },
        },
    };
}

describe("isTaskTotalEtaReady", () => {
    test("a read session shows its total once the session locks it", () => {
        const unlocked = emit([...started(), hydrating()]);
        expect(isTaskTotalEtaReady(unlocked.progress, false)).toBe(false);

        const locked = emit([...started(), { kind: "sessionTotalsLocked" }, hydrating()]);
        expect(isTaskTotalEtaReady(locked.progress, false)).toBe(true);
    });

    test("an import withholds its total until the apply phase", () => {
        const locked = emit([...started(), { kind: "sessionTotalsLocked" }, hydrating()]);
        expect(isTaskTotalEtaReady(locked.progress, true)).toBe(false);

        const applying = reduce(locked, {
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
        expect(isTaskTotalEtaReady(applying.progress, true)).toBe(true);
    });
});
