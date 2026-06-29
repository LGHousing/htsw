import { describe, expect, test } from "vitest";

import { applyActionListPlan } from "../src/housingSync/actions/applyDiff";
import {
    actionPathFromKey,
    type ImportEvent,
    type ImportEventHandler,
} from "../src/housingSync/importEvents";
import type { ActionListDiff } from "../src/housingSync/types";
import type { ActionListPlan } from "../src/housingSync/actions/plan";
import { createItemRegistry } from "../src/importables/itemRegistry";
import type { ImportSession } from "../src/importables/imports";
import { orderImportablesForImportSession } from "../src/importables/importSession";
import { createNpcLookupCache } from "../src/importables/npcs/listNpcs";
import type { ImportableItem } from "htsw/types";

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

function sessionWith(handler: ImportEventHandler): ImportSession {
    return {
        parsed: { value: [] } as never,
        items: createItemRegistry([]),
        housingUuid: "test-house",
        trust: { housingUuid: "test-house", importables: new Map() },
        events: handler,
        npcLookup: createNpcLookupCache(),
    };
}

describe("applyActionListPlan — top-level-only terminal events", () => {
    test("top-level empty-diff apply emits listSyncCompleted", async () => {
        const handler = recordingHandler();
        await applyActionListPlan(
            null as never,
            emptyPlan(),
            { session: sessionWith(handler) }
        );
        const kinds = handler.events.map((e) => e.kind);
        expect(kinds).toContain("listSyncCompleted");
    });

    test("nested empty-diff apply does NOT emit listSyncCompleted", async () => {
        const handler = recordingHandler();
        await applyActionListPlan(
            null as never,
            emptyPlan(),
            {
                session: sessionWith(handler),
                listPath: actionPathFromKey("5.ifActions"),
            }
        );
        const kinds = handler.events.map((e) => e.kind);
        expect(kinds).not.toContain("listSyncCompleted");
        expect(kinds).not.toContain("finalizeSource");
    });
});

describe("orderImportablesForImportSession", () => {
    test("orders item dependencies before dependent items", () => {
        const dependency: ImportableItem = {
            type: "ITEM",
            name: "Dependency",
            nbt: { type: "compound", value: {} },
        };
        const dependent: ImportableItem = {
            type: "ITEM",
            name: "Dependent",
            nbt: { type: "compound", value: {} },
            leftClickActions: [
                {
                    type: "GIVE_ITEM",
                    itemName: "Dependency",
                    allowMultiple: false,
                    slot: 0,
                    replaceExisting: false,
                },
            ],
        };

        expect(orderImportablesForImportSession([], [dependent, dependency])).toEqual([
            dependency,
            dependent,
        ]);
    });
});
