import { describe, expect, test } from "vitest";

import { parseCommandArgs, quoteCommandArg } from "../src/utils/commandArgs";
import {
    IMPORT_USAGE,
    parseImportCommandArgs,
} from "../src/slashCommands/importArgs";

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

describe("parseImportCommandArgs", () => {
    test("documents skip and per-list accept syntax", () => {
        expect(IMPORT_USAGE).toContain("--on-conflict=cancel|skip");
        expect(IMPORT_USAGE).toContain("--accept TYPE:name[:basePath]");
    });
    test("strips the cancel policy flag from the import path", () => {
        expect(
            parseImportCommandArgs([
                "projects/My",
                "--on-conflict=cancel",
                "House/import.json",
            ])
        ).toEqual({
            pathArgs: ["projects/My", "House/import.json"],
            onConflict: "cancel",
            accepts: [],
            fresh: false,
        });
    });

    test("strips the fresh flag from the import path", () => {
        expect(parseImportCommandArgs(["--fresh", "import.json"])).toEqual({
            pathArgs: ["import.json"],
            onConflict: "prompt",
            accepts: [],
            fresh: true,
        });
    });

    test("parses skip and repeatable per-list accepts", () => {
        expect(
            parseImportCommandArgs([
                "--on-conflict=skip",
                "--accept",
                "ITEM:Wand:leftClickActions",
                "--accept",
                "FUNCTION:Debug",
                "import.json",
            ])
        ).toEqual({
            pathArgs: ["import.json"],
            onConflict: "skip",
            accepts: [
                "ITEM:Wand:leftClickActions",
                "FUNCTION:Debug",
            ],
            fresh: false,
        });
    });

    test("rejects a missing accept identifier", () => {
        expect(parseImportCommandArgs(["import.json", "--accept"])).toMatchObject({
            error: "--accept requires TYPE:name or TYPE:name:basePath",
        });
    });
});
