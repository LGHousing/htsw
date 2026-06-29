import { describe, expect, test } from "vitest";

import { actionSummaryHasActions } from "../src/housingSync/fields/loreParsing";

function slotWithLore(lore: string[]) {
    return {
        getItem: () => ({
            getLore: () => lore,
        }),
    } as never;
}

describe("actionSummaryHasActions", () => {
    test("treats Actions: - None as empty", () => {
        expect(actionSummaryHasActions(slotWithLore([
            "Edit the actions.",
            "Actions:",
            "- None",
            "",
            "Click to edit!",
        ]))).toBe(false);
    });

    test("detects summarized action entries", () => {
        expect(actionSummaryHasActions(slotWithLore([
            "Actions:",
            "- Trigger Function",
            "- Display Menu",
            "",
            "Click to edit!",
        ]))).toBe(true);
    });

    test("defaults to true when no summary exists", () => {
        expect(actionSummaryHasActions(slotWithLore(["Click to edit!"]))).toBe(true);
    });
});
