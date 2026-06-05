import { describe, expect, test } from "vitest";

import { applyActionListPlan } from "../src/housingSync/actions/applyDiff";
import {
    actionPathFromKey,
    type ImportEvent,
    type ImportEventHandler,
} from "../src/housingSync/importEvents";
import type { ActionListDiff } from "../src/housingSync/types";
import type { ActionListPlan } from "../src/housingSync/actions/plan";

function recordingHandler(): ImportEventHandler & { events: ImportEvent[] } {
    const events: ImportEvent[] = [];
    return {
        events,
        emit: (event) => { events.push(event); },
    };
}

const emptyDiff: ActionListDiff = { operations: [], desiredLength: 0 };

function emptyPlan(): ActionListPlan {
    return {
        desired: [],
        observed: [],
        diff: emptyDiff,
        phaseUnits: {
            setup: 0,
            reading: 0,
            hydrating: 0,
            applying: 1,
        },
    };
}

describe("applyActionListPlan — top-level-only terminal events", () => {
    test("top-level empty-diff apply emits listSyncCompleted", async () => {
        const handler = recordingHandler();
        await applyActionListPlan(
            null as never,
            emptyPlan(),
            { events: handler }
        );
        const kinds = handler.events.map((e) => e.kind);
        expect(kinds).toContain("listSyncCompleted");
    });

    test("nested empty-diff apply does NOT emit listSyncCompleted", async () => {
        const handler = recordingHandler();
        await applyActionListPlan(
            null as never,
            emptyPlan(),
            { listPath: actionPathFromKey("5.ifActions"), events: handler }
        );
        const kinds = handler.events.map((e) => e.kind);
        expect(kinds).not.toContain("listSyncCompleted");
        expect(kinds).not.toContain("finalizeSource");
    });
});
