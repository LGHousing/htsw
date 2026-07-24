import { describe, expect, it } from "vitest";

import {
    observedNodesFromSlots,
    type ChildListSummaries,
    type Observed,
    type ObservedActionSlot,
} from "../src/housingSync/observedActions";

function nodeFrom(
    action: Observed,
    summaries: ChildListSummaries
) {
    const slots: ObservedActionSlot[] = [
        {
            index: 0,
            action,
            hydrated: false,
            truncatedFields: [],
            childListSummaries: summaries,
            childListsToRead: new Set(Object.keys(summaries) as Array<keyof ChildListSummaries>),
        },
    ];
    return observedNodesFromSlots(slots)[0];
}

describe("observedNodesFromSlots child-list knowledge", () => {
    it("uses a conditional summary when conditions are unread", () => {
        const node = nodeFrom(
            { type: "CONDITIONAL", matchAny: false },
            { conditions: ["COMPARE_VAR"] }
        );

        expect(node).toMatchObject({
            kind: "partial",
            childLists: {
                conditions: { state: "summary", types: ["COMPARE_VAR"] },
            },
        });
    });

    it("keeps genuinely read-empty conditional conditions known", () => {
        const node = nodeFrom(
            { type: "CONDITIONAL", matchAny: false, conditions: [] },
            { conditions: ["COMPARE_VAR"] }
        );

        expect(node).toMatchObject({
            kind: "partial",
            childLists: {
                conditions: { state: "conditions", entries: [] },
            },
        });
    });

    it("distinguishes unread and genuinely read-empty random actions", () => {
        const unread = nodeFrom(
            { type: "RANDOM" },
            { actions: ["ACTION_BAR"] }
        );
        const empty = nodeFrom(
            { type: "RANDOM", actions: [] },
            { actions: ["ACTION_BAR"] }
        );

        expect(unread).toMatchObject({
            kind: "partial",
            childLists: {
                actions: { state: "summary", types: ["ACTION_BAR"] },
            },
        });
        expect(empty).toMatchObject({
            kind: "partial",
            childLists: {
                actions: { state: "actions", entries: [] },
            },
        });
    });
});
