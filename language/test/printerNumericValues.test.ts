import { describe, expect, it } from "vitest";

import { htsl, type types } from "../src";

function changeVar(value: string): types.ActionChangeVar {
    return {
        type: "CHANGE_VAR",
        holder: { type: "Player" },
        key: "foo",
        op: "Set",
        value,
        unset: false,
    };
}

describe("printer: numeric values", () => {
    it("removes GUI grouping commas from a large double literal", () => {
        const value = "2,284,413,586,539,756,500,000,000.0";

        expect(htsl.printAction(changeVar(value))).toBe(
            "var foo = 2284413586539756500000000.0 false\n"
        );
    });

    it("preserves ordinary numeric literals", () => {
        expect(htsl.printAction(changeVar("1234.5"))).toBe(
            "var foo = 1234.5 false\n"
        );
    });

    it("preserves commas inside quoted strings", () => {
        expect(htsl.printAction(changeVar('"hello, world"'))).toBe(
            'var foo = "hello, world" false\n'
        );
    });
});
