import { describe, expect, test } from "vitest";

import { applyActionListDiff } from "../src/importer/actions/applyDiff";
import type {
    ImportEvent,
    ImportEventHandler,
} from "../src/importer/importEvents";
import type { ActionListDiff } from "../src/importer/types";

function recordingHandler(): ImportEventHandler & { events: ImportEvent[] } {
    const events: ImportEvent[] = [];
    return {
        events,
        emit: (event) => { events.push(event); },
        phaseUnits: () => {},
    };
}

const emptyDiff: ActionListDiff = { operations: [], desiredLength: 0 };

describe("applyActionListDiff — top-level-only terminal events", () => {
    // Regression test: writeConditional → syncActionList → applyActionListDiff
    // with a pathPrefix was emitting the "whole sync done" signal mid-import,
    // clearing the outer cursor. The fix is the `isTopLevel` gate around
    // `listSyncCompleted` and `finalizeSource` emits.

    test("top-level empty-diff apply emits listSyncCompleted", async () => {
        const handler = recordingHandler();
        await applyActionListDiff(
            null as never,
            [],
            [],
            emptyDiff,
            undefined,
            undefined,
            undefined,
            handler
        );
        const kinds = handler.events.map((e) => e.kind);
        expect(kinds).toContain("listSyncCompleted");
    });

    test("nested empty-diff apply does NOT emit listSyncCompleted", async () => {
        const handler = recordingHandler();
        await applyActionListDiff(
            null as never,
            [],
            [],
            emptyDiff,
            undefined,
            "5.ifActions",
            undefined,
            handler
        );
        const kinds = handler.events.map((e) => e.kind);
        expect(kinds).not.toContain("listSyncCompleted");
        expect(kinds).not.toContain("finalizeSource");
    });
});
