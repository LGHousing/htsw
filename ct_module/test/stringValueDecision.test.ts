import { describe, expect, it } from "vitest";

import { decideStringWrite } from "../src/housingSync/menus/stringValueDecision";

describe("decideStringWrite", () => {
    it("skips when the field already holds the desired value", () => {
        expect(decideStringWrite("hello", "hello")).toBe("skip");
    });

    it("enters a non-empty value onto an empty field", () => {
        expect(decideStringWrite(null, "hello")).toBe("enter");
    });

    it("enters a non-empty value that differs from the current one", () => {
        expect(decideStringWrite("old", "new")).toBe("enter");
    });

    // The regression this guards: a title action with an empty subtitle read
    // back as null; the old guard proceeded to submit an empty chat message,
    // which the server drops, hanging the import until the menu-wait timed out.
    it("skips an empty desired value when the field is already empty", () => {
        expect(decideStringWrite(null, "")).toBe("skip");
    });

    it("reports cannot-clear when emptying a field that currently has a value", () => {
        expect(decideStringWrite("subtitle text", "")).toBe("cannot-clear");
    });
});
