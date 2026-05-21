import { describe, expect, test } from "vitest";

import { applyActionListDiff } from "../src/importer/actions/applyDiff";
import type {
    ImportPreviewEvent,
    ImportPreviewEventHandler,
} from "../src/importer/importPreviewEvents";
import type { ActionListDiff } from "../src/importer/types";

function recordingHandler(): ImportPreviewEventHandler & { events: ImportPreviewEvent[] } {
    const events: ImportPreviewEvent[] = [];
    return {
        events,
        emit: (event) => { events.push(event); },
    };
}

const emptyDiff: ActionListDiff = { operations: [], desiredLength: 0 };

describe("applyActionListDiff — top-level-only terminal events", () => {
    // Regression test: writeConditional → syncActionList → applyActionListDiff
    // with a pathPrefix was emitting the "whole sync done" signal mid-import,
    // clearing the outer cursor. The fix is the `isTopLevel` gate around
    // `syncCompleted` and `finalizeSource` emits.

    test("top-level empty-diff apply emits syncCompleted", async () => {
        const handler = recordingHandler();
        await applyActionListDiff(
            null as never,
            [],
            [],
            emptyDiff,
            undefined,
            undefined,
            undefined,
            undefined,
            handler
        );
        const kinds = handler.events.map((e) => e.kind);
        expect(kinds).toContain("syncCompleted");
    });

    test("nested empty-diff apply does NOT emit syncCompleted", async () => {
        const handler = recordingHandler();
        await applyActionListDiff(
            null as never,
            [],
            [],
            emptyDiff,
            undefined,
            undefined,
            "5.ifActions",
            undefined,
            handler
        );
        const kinds = handler.events.map((e) => e.kind);
        expect(kinds).not.toContain("syncCompleted");
        expect(kinds).not.toContain("finalizeSource");
    });
});
