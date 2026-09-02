import { describe, expect, test } from "vitest";
import { parseActionsResult, SourceFile, SourceMap } from "htsw";

import {
    changedItemSpanFallback,
    changedItemSpanFor,
} from "../src/gui/code-view/sourceDiff";
import { tokensWithMarks } from "../src/gui/code-view/tokenMarks";

function parsedSource(source: string) {
    const path = "items.htsl";
    const sm = new SourceMap({
        fileExists: () => false,
        readFile: () => "",
        getParentPath: () => "",
        resolvePath: (_base: string, other: string) => other,
    });
    const file = new SourceFile(path, source);
    sm.registerFile(file);
    const result = parseActionsResult(sm, path);
    return { actions: result.value, spans: result.spans, file };
}

describe("code-view item marks", () => {
    test("splits tokens at mark boundaries and applies links", () => {
        const tokens = tokensWithMarks(
            [{ text: "abcdef", color: 1 }],
            [{ startColumn: 2, endColumn: 5, underlineColor: 2, linkTarget: "item.snbt" }]
        );

        expect(tokens.map((token) => token.text)).toEqual(["ab", "cde", "f"]);
        expect(tokens[1]).toMatchObject({ underlineColor: 2, linkTarget: "item.snbt" });
        expect(tokens[0].linkTarget).toBeUndefined();
    });

    test("keeps a diagnostic underline while still applying the link", () => {
        const tokens = tokensWithMarks(
            [{ text: "axe", color: 1, underlineColor: 9 }],
            [{ startColumn: 0, endColumn: 3, underlineColor: 2, linkTarget: "axe.snbt" }]
        );

        expect(tokens[0]).toMatchObject({ underlineColor: 9, linkTarget: "axe.snbt" });
    });

    test("returns a shallow token-array copy for no marks", () => {
        const original = [{ text: "axe", color: 1 }];
        const tokens = tokensWithMarks(original, []);
        expect(tokens).toEqual(original);
        expect(tokens).not.toBe(original);
    });

    test("locates a condition item field span from an actual parse", () => {
        const source =
            "if or (hasItem wooden_axe Item_Type Hand Any_Amount, hasItem stone_axe Item_Type Hand Any_Amount) {\n" +
            "    var x = 1\n" +
            "}";
        const parsed = parsedSource(source);
        const action = parsed.actions[0];
        expect(action.type).toBe("CONDITIONAL");
        if (action.type !== "CONDITIONAL") return;

        const span = changedItemSpanFor(
            parsed,
            action.conditions[1],
            "itemName"
        );
        const startColumn = source.split("\n")[0].indexOf("stone_axe");
        expect(span).toEqual({
            line: 1,
            startColumn,
            endColumn: startColumn + "stone_axe".length,
        });
    });

    test("fallback requires whole identifiers", () => {
        const parsed = parsedSource("giveItem stone_axe2 false\ngiveItem stone_axe false");
        expect(changedItemSpanFallback(parsed, { start: 1, end: 2 }, "stone_axe"))
            .toEqual({ line: 2, startColumn: 9, endColumn: 18 });
    });
});
