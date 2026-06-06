import { describe, expect, test } from "vitest";
import { Diagnostic, SourceFile, SourceMap, Span } from "htsw";

import { formatDiagnostic, formatDiagnostics } from "../src/diagnostics/format";
import { normalizeDiagnosticSpans } from "../src/diagnostics/spans";
import { placeAnchoredRect } from "../src/gui/lib/anchoredRect";

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

        expect(text).toContain("&c&lerror&7: &f&lMismatched types");
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
            "&c&lerror&7: &f&lone",
            "",
            "&e&lwarning&7: &f&ltwo",
        ]);
    });

    test("formats without Array.prototype.flat", () => {
        const sm = sourceMap([{ path: "a.htsl", src: "var foo = bar" }]);
        const file = sm.sourceFiles[0];
        const diagnostic = Diagnostic.error("Mismatched types")
            .addPrimarySpan(new Span(file.startPos + 4, file.startPos + 7));
        const originalFlat = Array.prototype.flat;
        delete (Array.prototype as { flat?: typeof originalFlat }).flat;
        try {
            expect(formatDiagnostic(sm, diagnostic, 200).lines.length).toBeGreaterThan(0);
        } finally {
            Array.prototype.flat = originalFlat;
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

describe("anchored card placement", () => {
    test("flips above and clamps to the screen", () => {
        expect(placeAnchoredRect({ x: 90, y: 90, w: 10, h: 10 }, 40, 30, 100, 100))
            .toEqual({ x: 58, y: 58, w: 40, h: 30 });
    });
});
