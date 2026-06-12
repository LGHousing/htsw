import { describe, expect, test } from "vitest";
import { Diagnostic, SourceFile } from "htsw";

import { tokensWithDiagnosticSpans } from "../src/gui/code-view/lineModel";
import { wrapTokensIntoVisualRows } from "../src/gui/code-view/wrap";
import { hoverPath } from "../src/gui/diagnostics/hover";
import type { DiagnosticLineSpan } from "../src/diagnostics/spans";

function lineSpan(
    diagnostic: Diagnostic,
    startColumn: number,
    endColumn: number,
    kind: "primary" | "secondary",
    order: number
): DiagnosticLineSpan {
    return {
        rootDiagnostic: diagnostic,
        diagnostic,
        kind,
        level: diagnostic.level,
        file: new SourceFile("a.htsl", "abcdef"),
        line: 1,
        startColumn,
        endColumn,
        order,
    };
}

describe("code-view diagnostic tokens", () => {
    test("shows hover paths from the projects root", () => {
        expect(hoverPath("C:\\instances\\1.8.9 good\\.minecraft\\htsw\\projects\\SMPmap\\Raycast.htsl"))
            .toBe("htsw/projects/SMPmap/Raycast.htsl");
        expect(hoverPath("/home/user/projects/SMPmap/Raycast.htsl"))
            .toBe("projects/SMPmap/Raycast.htsl");
    });

    test("splits tokens at span boundaries and primary spans win overlaps", () => {
        const warning = Diagnostic.warning("warning");
        const error = Diagnostic.error("error");
        const tokens = tokensWithDiagnosticSpans(
            [{ text: "abcdef", color: 1 }],
            [
                lineSpan(warning, 1, 5, "secondary", 0),
                lineSpan(error, 3, 4, "primary", 1),
            ]
        );

        expect(tokens.map((token) => token.text)).toEqual(["a", "bc", "d", "e", "f"]);
        expect(tokens[0].underlineColor).toBeUndefined();
        expect(tokens[1].underlineColor).toBe(0xff67a7e8 | 0);
        expect(tokens[2].underlineColor).toBe(0xffe85c5c | 0);
    });

    test("wrapping preserves underline colors", () => {
        const rows = wrapTokensIntoVisualRows(
            [{ text: "abcdefghijkl", color: 1, underlineColor: 2 }],
            6
        );
        expect(rows.length).toBe(2);
        expect(rows[0][0].underlineColor).toBe(2);
        expect(rows[1][0].underlineColor).toBe(2);
    });
});
