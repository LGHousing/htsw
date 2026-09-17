import { describe, expect, test } from "vitest";

import { createProgressGroup } from "../src/housingSync/progress/group";
import type { SyncEvent, SyncEventHandler } from "../src/housingSync/syncEvents";

describe("progress group", () => {
    test("adds progress from separate action lists instead of restarting per list", () => {
        const emitted: SyncEvent[] = [];
        const events: SyncEventHandler = {
            emit(event) {
                emitted.push(event);
            },
        };
        const group = createProgressGroup(events, 2);
        const first = group.part(0);
        const second = group.part(1);

        first({
            phase: "reading",
            completedUnits: 4,
            totalUnits: 6,
            phaseUnits: { setup: 0, reading: 4, hydrating: 2, applying: 8 },
            sync: { completedUnits: 3, totalUnits: 3, parent: null },
        });
        second({
            phase: "hydrating",
            completedUnits: 5,
            totalUnits: 7,
            phaseUnits: { setup: 0, reading: 3, hydrating: 4, applying: 9 },
            sync: { completedUnits: 2, totalUnits: 4, parent: null },
        });

        const latest = emitted[emitted.length - 1];
        expect(latest.kind).toBe("progress");
        if (latest.kind !== "progress") return;
        expect(latest.progress.completedUnits).toBe(9);
        expect(latest.progress.totalUnits).toBe(13);
        expect(latest.progress.phaseUnits).toEqual({
            setup: 0,
            reading: 7,
            hydrating: 6,
            applying: 0,
        });
        expect(latest.progress.sync).toEqual({
            completedUnits: 2,
            totalUnits: 4,
            parent: null,
        });
    });

    test("books the navigation to a part before the part reports anything", () => {
        const emitted: SyncEvent[] = [];
        const group = createProgressGroup({ emit: (event) => emitted.push(event) }, 2);

        group.visited(0, 5);
        group.visited(1, 5);
        group.visited(1, 5);

        const latest = emitted[emitted.length - 1];
        if (latest.kind !== "progress") throw new Error("expected progress");
        expect(latest.progress.phase).toBe("hydrating");
        expect(latest.progress.completedUnits).toBe(15);
        expect(latest.progress.phaseUnits).toEqual({
            setup: 0,
            reading: 10,
            hydrating: 5,
            applying: 0,
        });
    });
});
