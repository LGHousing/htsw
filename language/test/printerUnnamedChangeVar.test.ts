import { describe, expect, it } from "vitest";

import { htsl, type types } from "../src";

describe("printer: Change Variable without a name", () => {
    it("exports a visible placeholder with the read-back fields instead of throwing", () => {
        // Seen live in guh: an old Change Variable inside a Conditional read back with no key.
        const action = {
            type: "CHANGE_VAR",
            holder: { type: "Team", team: "T4" },
            op: "Set",
            value: "1",
            unset: false,
        } as unknown as types.ActionChangeVar;
        const conditional = {
            type: "CONDITIONAL",
            matchAny: false,
            conditions: [],
            ifActions: [action],
            elseActions: [],
        } as unknown as types.Action;

        const out = htsl.printAction(conditional);
        expect(out).toContain("/// HTSW export: this Change Variable has no variable name in Housing");
        expect(out).toContain('"team":"T4"');
        expect(out).toContain('teamvar "" T4 = 1 false');
    });
});
