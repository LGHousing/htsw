import { describe, expect, test } from "vitest";
import { Diagnostic, SourceFile, SourceMap, Span } from "htsw";

import { formatDiagnostic, formatDiagnostics } from "../src/diagnostics/format";
import { normalizeDiagnosticSpans } from "../src/diagnostics/spans";
import { placeAnchoredRect } from "../src/gui/lib/anchoredRect";
import { TextLayoutWrap } from "../src/diagnostics/textLayout";
import { chatWidth } from "../src/utils/helpers";

function sourceMap(files: { path: string; src: string }[]): SourceMap {
    const sm = new SourceMap({
        fileExists: () => false,
        readFile: () => "",
        getParentPath: () => "",
        resolvePath: (_base: string, other: string) => other,
    });
    for (let i = 0; i < files.length; i++) {
        sm.registerFile(new SourceFile(files[i].path, files[i].src));
    }
    return sm;
}

describe("normalizeDiagnosticSpans", () => {
    test("splits multi-line spans and associates child spans with the root", () => {
        const sm = sourceMap([{ path: "a.htsl", src: "first\nsecond\nthird" }]);
        const file = sm.sourceFiles[0];
        const child = Diagnostic.help("child").addSecondarySpan(
            new Span(file.getLineStartPos(3), file.getLineStartPos(3) + 5),
            "child label"
        );
        const root = Diagnostic.error("root")
            .addPrimarySpan(new Span(file.getLineStartPos(1) + 2, file.getLineStartPos(3) + 2))
            .addSubDiagnostic(child);
        const spans = normalizeDiagnosticSpans(sm, [root]);

        expect(spans.filter((span) => span.diagnostic === root).map((span) => ({
            line: span.line,
            start: span.startColumn,
            end: span.endColumn,
        }))).toEqual([
            { line: 1, start: 2, end: 5 },
            { line: 2, start: 0, end: 6 },
            { line: 3, start: 0, end: 2 },
        ]);
        expect(spans.find((span) => span.diagnostic === child)?.rootDiagnostic).toBe(root);
    });

    test("gives zero-width and EOF spans visible ranges", () => {
        const sm = sourceMap([{ path: "a.htsl", src: "abc\nz" }]);
        const file = sm.sourceFiles[0];
        const diagnostic = Diagnostic.error("x")
            .addPrimarySpan(Span.at(file.getLineStartPos(1) + 1))
            .addSecondarySpan(Span.at(file.endPos()));
        const spans = normalizeDiagnosticSpans(sm, [diagnostic]);
        expect(spans.map((span) => [span.line, span.startColumn, span.endColumn])).toEqual([
            [1, 1, 2],
            [2, 1, 2],
        ]);
    });

    test("does not include the next line when an end-exclusive span stops at its start", () => {
        const sm = sourceMap([{ path: "a.htsl", src: "abc\ndef" }]);
        const file = sm.sourceFiles[0];
        const diagnostic = Diagnostic.error("x").addPrimarySpan(
            new Span(file.getLineStartPos(1), file.getLineStartPos(2)),
            "once"
        );
        const spans = normalizeDiagnosticSpans(sm, [diagnostic]);
        expect(spans.map((span) => [span.line, span.label])).toEqual([[1, "once"]]);
    });

    test("supports spans in multiple source files", () => {
        const sm = sourceMap([
            { path: "a.htsl", src: "a" },
            { path: "b.htsl", src: "b" },
        ]);
        const diagnostic = Diagnostic.error("x")
            .addPrimarySpan(new Span(sm.sourceFiles[0].startPos, sm.sourceFiles[0].endPos()))
            .addSecondarySpan(new Span(sm.sourceFiles[1].startPos, sm.sourceFiles[1].endPos()));
        expect(normalizeDiagnosticSpans(sm, [diagnostic]).map((span) => span.file.path)).toEqual([
            "a.htsl",
            "b.htsl",
        ]);
    });
});

describe("shared diagnostic formatting", () => {
    test("renders severity, spans, labels, and child diagnostics once", () => {
        const sm = sourceMap([{ path: "a.htsl", src: "var foo = bar" }]);
        const file = sm.sourceFiles[0];
        const root = Diagnostic.error("Mismatched types")
            .addPrimarySpan(new Span(file.startPos + 4, file.startPos + 7), "Type is int")
            .addSecondarySpan(new Span(file.startPos + 10, file.startPos + 13), "Type is string")
            .addSubDiagnostic(Diagnostic.help("Change one side"));
        const block = formatDiagnostic(sm, root, 200);
        const text = block.lines.join("\n");

        expect(text).toContain("&c&lerror&r&7: &f&lMismatched types");
        expect(text).toContain("Type is int");
        expect(text).toContain("Type is string");
        expect(text.match(/Change one side/g)?.length).toBe(1);
    });

    test("separates stacked diagnostics with a blank line", () => {
        const sm = sourceMap([{ path: "a.htsl", src: "x" }]);
        const block = formatDiagnostics(sm, [
            Diagnostic.error("one"),
            Diagnostic.warning("two"),
        ], 200);
        expect(block.lines).toEqual([
            "&c&lerror&r&7: &f&lone",
            "",
            "&e&lwarning&r&7: &f&ltwo",
        ]);
    });

    test("formats without Array.prototype.flat", () => {
        const sm = sourceMap([{ path: "a.htsl", src: "var foo = bar" }]);
        const file = sm.sourceFiles[0];
        const diagnostic = Diagnostic.error("Mismatched types")
            .addPrimarySpan(new Span(file.startPos + 4, file.startPos + 7));
        const arrayPrototype = Array.prototype as { flat?: unknown };
        const originalFlat = arrayPrototype.flat;
        delete arrayPrototype.flat;
        try {
            expect(formatDiagnostic(sm, diagnostic, 200).lines.length).toBeGreaterThan(0);
        } finally {
            arrayPrototype.flat = originalFlat;
        }
    });

    test("allows consumers to shorten displayed paths", () => {
        const sm = sourceMap([{ path: "C:\\game\\htsw\\imports\\SMPmap\\test.htsl", src: "x" }]);
        const file = sm.sourceFiles[0];
        const diagnostic = Diagnostic.error("x").addPrimarySpan(
            new Span(file.startPos, file.endPos())
        );
        const block = formatDiagnostic(sm, diagnostic, 200, (path) => {
            const parts = path.split("\\");
            return parts.slice(parts.length - 2).join("/");
        });
        expect(block.lines.join("\n")).toContain("SMPmap/test.htsl:1:1");
        expect(block.lines.join("\n")).not.toContain("C:\\game");
    });

    test("wraps long source snippets without detaching late underlines", () => {
        const src = "var early = 1 and this diagnostic target is near the end";
        const sm = sourceMap([{ path: "a.htsl", src }]);
        const file = sm.sourceFiles[0];
        const targetStart = src.indexOf("target");
        const diagnostic = Diagnostic.error("x").addPrimarySpan(
            new Span(file.startPos + targetStart, file.startPos + targetStart + "target".length)
        );
        const block = formatDiagnostic(sm, diagnostic, 30);
        const text = block.lines.join("\n");

        expect(text).toContain("target");
        expect(text).toContain("&c^");
        expect(block.lines.every((line) => line.replace(/&[0-9a-fklmnor]/gi, "").length <= 30))
            .toBe(true);
    });

});

describe("long diagnostic messages", () => {
    const unwrap = (line: string) => line.replace(/&[0-9a-fklmnor]/gi, "");

    test("wraps a message that would overflow the card instead of cutting it", () => {
        const sm = sourceMap([{ path: "a.htsl", src: "x" }]);
        const message =
            "`dangerouslyDeleteEverythingNotInThisFile` requires `houseUuid` to be set";
        const block = formatDiagnostic(sm, Diagnostic.error(message), 40);

        expect(block.lines.length).toBeGreaterThan(1);
        // Rendered width, not character count: the message draws bold, and it
        // is exactly that extra per-glyph pixel that used to overflow the card.
        for (const line of block.lines) expect(chatWidth(line)).toBeLessThanOrEqual(40);
        expect(block.width).toBeLessThanOrEqual(40);
        // Nothing is dropped. Spaces are ignored on both sides because the
        // wrap both consumes them at breaks and adds them as continuation
        // indent; what matters is that every character of the message survives.
        const squashed = block.lines.map(unwrap).join("").replace(/ /g, "");
        expect(squashed).toContain(message.replace(/ /g, ""));
        expect(squashed).not.toContain("...");
    });

    test("indents continuation lines under the level prefix", () => {
        const sm = sourceMap([{ path: "a.htsl", src: "x" }]);
        const block = formatDiagnostic(
            sm,
            Diagnostic.error("alpha bravo charlie delta echo foxtrot golf"),
            24
        );

        const prefixWidth = chatWidth("&c&lerror&r&7: ");
        expect(unwrap(block.lines[0]).startsWith("error: ")).toBe(true);
        expect(block.lines.length).toBeGreaterThan(1);
        for (let i = 1; i < block.lines.length; i++) {
            expect(unwrap(block.lines[i]).startsWith(" ")).toBe(true);
            expect(block.segments[i][0].x).toBe(prefixWidth);
        }
    });

    test("fills the first line when the next word must be split anyway", () => {
        const sm = sourceMap([{ path: "a.htsl", src: "x" }]);
        // One unbreakable word, far too wide for any line. Breaking at the
        // space after "error:" would strand the label on a line of its own and
        // split the word on the next line regardless, so the split starts here.
        const block = formatDiagnostic(
            sm,
            Diagnostic.error("dangerouslyDeleteEverythingNotInThisFile"),
            40
        );

        expect(unwrap(block.lines[0]).startsWith("error: d")).toBe(true);
        expect(chatWidth(block.lines[0])).toBeGreaterThan(30);
        for (const line of block.lines) expect(chatWidth(line)).toBeLessThanOrEqual(40);
    });

    test("reopens active formatting on each continuation line", () => {
        const sm = sourceMap([{ path: "a.htsl", src: "x" }]);
        const block = formatDiagnostic(
            sm,
            Diagnostic.error("alpha bravo charlie delta echo foxtrot golf"),
            24
        );

        // The message runs in white+bold; a continuation line that dropped the
        // codes would render grey and unbolded halfway through the sentence.
        for (let i = 1; i < block.lines.length; i++) {
            expect(block.segments[i][0].text.startsWith("&f&l")).toBe(true);
        }
    });

    test("breaks a single unbroken token rather than overflowing", () => {
        const sm = sourceMap([{ path: "a.htsl", src: "x" }]);
        const block = formatDiagnostic(
            sm,
            Diagnostic.error("dangerouslyDeleteEverythingNotInThisFile"),
            20
        );

        expect(block.lines.length).toBeGreaterThan(1);
        for (const line of block.lines) expect(chatWidth(line)).toBeLessThanOrEqual(20);
        expect(block.lines.map(unwrap).join("").replace(/ /g, ""))
            .toContain("dangerouslyDeleteEverythingNotInThisFile");
    });

    test("measures bold at its drawn width, so a bold message wraps", () => {
        const sm = sourceMap([{ path: "a.htsl", src: "x" }]);
        // Diagnostic messages draw bold. Measured as regular text this fits on
        // one line; measured as it actually draws it does not, and laying it
        // out on one line is what let it spill past the card and get clipped.
        const message = "alpha bravo charlie delta";
        const plain = chatWidth(message);
        expect(chatWidth("&l" + message)).toBeGreaterThan(plain);

        const block = formatDiagnostic(sm, Diagnostic.error(message), plain + 8);
        expect(block.lines.length).toBeGreaterThan(1);
        for (const line of block.lines) {
            expect(chatWidth(line)).toBeLessThanOrEqual(plain + 8);
        }
    });

    test("wraps sub-diagnostic messages too", () => {
        const sm = sourceMap([{ path: "a.htsl", src: "x" }]);
        const block = formatDiagnostic(
            sm,
            Diagnostic.error("short").addSubDiagnostic(
                Diagnostic.help("Declare it in `functions`, or drop the key entirely")
            ),
            30
        );

        for (const line of block.lines) expect(chatWidth(line)).toBeLessThanOrEqual(30);
        const joined = block.lines.map(unwrap).join(" ").replace(/\s+/g, " ");
        for (const word of "Declare it in `functions`, or drop the key entirely".split(" ")) {
            expect(joined).toContain(word);
        }
    });
});

describe("TextLayoutWrap", () => {
    test("leaves text that already fits on one line", () => {
        const wrap = new TextLayoutWrap("&fshort enough", 40);
        expect(wrap.getHeight()).toBe(1);
        expect(wrap.render()).toEqual(["&fshort enough"]);
        expect(wrap.renderSegments()).toEqual([[{ x: 0, text: "&fshort enough" }]]);
    });

    test("without a hanging indent every line starts at x 0", () => {
        const wrap = new TextLayoutWrap("alpha bravo charlie delta echo", 12);
        expect(wrap.getHeight()).toBeGreaterThan(1);
        for (const segs of wrap.renderSegments()) expect(segs[0].x).toBe(0);
        expect(wrap.getWidth()).toBeLessThanOrEqual(12);
    });

    test("never loses a character to the break", () => {
        const text = "one two three four five six seven eight nine ten";
        const wrap = new TextLayoutWrap(text, 11);
        expect(wrap.render().join("").replace(/ /g, "")).toBe(text.replace(/ /g, ""));
    });

    test("makes progress even when the budget is narrower than a character", () => {
        const wrap = new TextLayoutWrap("abc", 0);
        expect(wrap.render()).toEqual(["a", "b", "c"]);
    });

    test("treats a non-code ampersand as literal width", () => {
        // `&&` is not a format code, so it costs two characters of budget and
        // must not be smuggled onto a line as if it were free.
        const wrap = new TextLayoutWrap("a&&b", 2);
        for (const line of wrap.render()) {
            expect(line.replace(/&[0-9a-fklmnor]/gi, "").length).toBeLessThanOrEqual(2);
        }
        expect(wrap.render().join("")).toBe("a&&b");
    });
});

describe("anchored card placement", () => {
    test("flips above and clamps to the screen", () => {
        expect(placeAnchoredRect({ x: 90, y: 90, w: 10, h: 10 }, 40, 30, 100, 100))
            .toEqual({ x: 58, y: 58, w: 40, h: 30 });
    });
});
