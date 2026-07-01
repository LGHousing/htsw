import { describe, expect, test } from "vitest";

import { extractCommandNameFromSlot } from "../src/importables/commands/listCommands";

describe("extractCommandNameFromSlot", () => {
    test("strips the command menu display slash", () => {
        expect(extractCommandNameFromSlot("/clear (#0422)")).toBe("clear");
        expect(extractCommandNameFromSlot("/clear")).toBe("clear");
    });

    test("preserves a slash that belongs to the command name", () => {
        expect(extractCommandNameFromSlot("//clear (#0422)")).toBe("/clear");
        expect(extractCommandNameFromSlot("//clear")).toBe("/clear");
    });

    test("ignores non-command display names", () => {
        expect(extractCommandNameFromSlot("clear (#0422)")).toBeNull();
    });
});
