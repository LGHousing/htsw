import { describe, expect, test } from "vitest";

import { parseCommandArgs, quoteCommandArg } from "../src/utils/commandArgs";

describe("parseCommandArgs", () => {
    test("keeps normal split args unchanged", () => {
        expect(parseCommandArgs(["hello", "frick"])).toEqual({
            ok: true,
            args: ["hello", "frick"],
        });
    });

    test("groups quoted args split by ChatTriggers", () => {
        expect(parseCommandArgs(["\"hello", "frick\"", "1"])).toEqual({
            ok: true,
            args: ["hello frick", "1"],
        });
    });

    test("unescapes quotes inside quoted args", () => {
        expect(parseCommandArgs(["\"hello", "\\\"frick\\\"\""])).toEqual({
            ok: true,
            args: ["hello \"frick\""],
        });
    });

    test("preserves non-quote backslashes", () => {
        expect(parseCommandArgs(["\"C:\\folder\""])).toEqual({
            ok: true,
            args: ["C:\\folder"],
        });
    });

    test("reports unclosed quotes", () => {
        expect(parseCommandArgs(["\"hello", "frick"])).toEqual({
            ok: false,
            error: "Unclosed quote.",
        });
    });
});

describe("quoteCommandArg", () => {
    test("quotes spaces and escapes quotes", () => {
        expect(quoteCommandArg("folder with \"quote\"")).toBe("\"folder with \\\"quote\\\"\"");
    });
});
