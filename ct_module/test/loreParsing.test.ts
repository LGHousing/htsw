import { describe, expect, test } from "vitest";

import { shallowActionListHasActions } from "../src/housingSync/fields/loreParsing";

function slotWithLore(lore: string[]) {
    return {
        getItem: () => ({
            getLore: () => lore,
        }),
    } as never;
}

describe("shallowActionListHasActions", () => {
    test("treats Actions: - None as empty", () => {
        expect(shallowActionListHasActions(slotWithLore([
            "Edit the actions.",
            "Actions:",
            "- None",
            "",
            "Click to edit!",
        ]))).toBe(false);
    });

    test("detects summarized action entries", () => {
        expect(shallowActionListHasActions(slotWithLore([
            "Actions:",
            "- Trigger Function",
            "- Display Menu",
            "",
            "Click to edit!",
        ]))).toBe(true);
    });

    test("defaults to true when no summary exists", () => {
        expect(shallowActionListHasActions(slotWithLore(["Click to edit!"]))).toBe(true);
    });
});
