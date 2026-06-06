import type { Diagnostic, DiagnosticLevel, SourceFile, SourceMap } from "htsw";

import { chatWidth, spaceWidth } from "../utils/helpers";
import { normalizeDiagnosticSpans, type DiagnosticLineSpan } from "./spans";
import {
    renderTextBlock,
    TextLayoutCanvas,
    TextLayoutHLine,
    TextLayoutText,
    TextLayoutTruncate,
    TextLayoutVLine,
    TextLayoutVStack,
    type FormattedTextBlock,
} from "./textLayout";

const LEVEL_NAMES: { [key in DiagnosticLevel]: string } = {
    bug: "bug", error: "error", warning: "warning", note: "note", help: "help",
};
const LEVEL_COLORS: { [key in DiagnosticLevel]: string } = {
    bug: "&4", error: "&c", warning: "&e", note: "&9", help: "&a",
};
const LEVEL_UNDERLINES: { [key in DiagnosticLevel]: string } = {
    bug: "^", error: "^", warning: "~", note: "-", help: "+",
};

function locationLine(path: string, line: number, column: number, maxWidth: number): string {
    const prefix = " --> ";
    const suffix = `:${line}:${column}`;
    if (chatWidth(prefix + path + suffix) <= maxWidth) return prefix + path + suffix;
    const ellipsis = "...";
    const budget = maxWidth - chatWidth(prefix) - chatWidth(suffix) - chatWidth(ellipsis);
    let tail = "";
    let width = 0;
    for (let i = path.length - 1; i >= 0; i--) {
        const ch = path.charAt(i);
        const chWidth = chatWidth(ch);
        if (width + chWidth > budget) break;
        tail = ch + tail;
        width += chWidth;
    }
    return prefix + ellipsis + tail + suffix;
}

function spansByFileAndLine(
    sm: SourceMap,
    diagnostic: Diagnostic
): Map<SourceFile, Map<number, DiagnosticLineSpan[]>> {
    const byFile = new Map<SourceFile, Map<number, DiagnosticLineSpan[]>>();
    const spans = normalizeDiagnosticSpans(sm, [diagnostic]);
    for (let i = 0; i < spans.length; i++) {
        const span = spans[i];
        if (span.diagnostic !== diagnostic) continue;
        let byLine = byFile.get(span.file);
        if (byLine === undefined) {
            byLine = new Map();
            byFile.set(span.file, byLine);
        }
        const line = byLine.get(span.line);
        if (line === undefined) byLine.set(span.line, [span]);
        else line.push(span);
    }
    return byFile;
}

function snippetLine(lineContent: string, formattedContent: string, spans: DiagnosticLineSpan[]): TextLayoutCanvas {
    const canvas = new TextLayoutCanvas();
    canvas.addElement(0, 0, new TextLayoutText(formattedContent));
    const occupation: number[] = [];
    const getLastX = (line: number): number => occupation[line] ?? Infinity;
    const sorted = spans.slice().sort((a, b) => a.startColumn - b.startColumn);
    for (let i = sorted.length - 1; i >= 0; i--) {
        const span = sorted[i];
        const underlineX = chatWidth(lineContent.substring(0, span.startColumn), false);
        const underlineWidth = chatWidth(
            lineContent.substring(span.startColumn, span.endColumn),
            false
        );
        const color = LEVEL_COLORS[span.level];
        const underlineChar = span.kind === "primary" ? color + LEVEL_UNDERLINES[span.level] : "&9-";
        const vLineChar = span.kind === "primary" ? color + "|" : "&9|";
        const labelColor = span.kind === "primary" ? color : "&9";
        canvas.addElement(
            underlineX,
            1,
            new TextLayoutHLine(Math.max(1, underlineWidth), underlineChar, labelColor)
        );
        if (!span.label) {
            occupation[0] = underlineX;
            continue;
        }
        const labelWidth = chatWidth(span.label);
        if (underlineX + underlineWidth + spaceWidth() + labelWidth < getLastX(0)) {
            canvas.addElement(
                underlineX + underlineWidth + spaceWidth(),
                1,
                new TextLayoutText(labelColor + span.label)
            );
            occupation[0] = underlineX;
            continue;
        }
        let line = 1;
        while (underlineX + labelWidth >= getLastX(line)) line++;
        for (let j = 0; j <= line; j++) occupation[j] = underlineX;
        canvas.addElement(underlineX, 2, new TextLayoutVLine(line, vLineChar));
        canvas.addElement(underlineX, 2 + line, new TextLayoutText(labelColor + span.label));
    }
    return canvas;
}

function lineChunks(lineContent: string, maxWidth: number): { start: number; end: number }[] {
    const chunks: { start: number; end: number }[] = [];
    let start = 0;
    while (start < lineContent.length) {
        let end = start;
        let width = 0;
        while (end < lineContent.length) {
            const charWidth = chatWidth(lineContent.charAt(end), false);
            if (end > start && width + charWidth > maxWidth) break;
            width += charWidth;
            end++;
        }
        chunks.push({ start, end });
        start = end;
    }
    if (chunks.length === 0) chunks.push({ start: 0, end: 0 });
    return chunks;
}

function snippetLineChunks(
    file: SourceFile,
    lineNumber: number,
    spans: DiagnosticLineSpan[],
    maxWidth: number
): TextLayoutVStack {
    const stack = new TextLayoutVStack();
    const lineContent = file.getLine(lineNumber).replace(/§/g, "&").replace(/\r/g, "");
    const chunks = lineChunks(lineContent, maxWidth);
    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const chunkSpans: DiagnosticLineSpan[] = [];
        for (let j = 0; j < spans.length; j++) {
            const span = spans[j];
            if (span.endColumn <= chunk.start || span.startColumn >= chunk.end) continue;
            chunkSpans.push({
                ...span,
                startColumn: Math.max(span.startColumn, chunk.start) - chunk.start,
                endColumn: Math.min(span.endColumn, chunk.end) - chunk.start,
                label: span.endColumn <= chunk.end ? span.label : undefined,
            });
        }
        const chunkContent = lineContent.substring(chunk.start, chunk.end);
        stack.add(snippetLine(
            chunkContent,
            "&7" + chunkContent.replace(/&/g, "&&7"),
            chunkSpans
        ));
    }
    return stack;
}

function snippetLines(
    file: SourceFile,
    byLine: Map<number, DiagnosticLineSpan[]>,
    maxWidth: number
): TextLayoutCanvas {
    const canvas = new TextLayoutCanvas();
    const lineNumbers = Array.from(byLine.keys());
    const originals = lineNumbers.slice();
    for (let i = 0; i < originals.length; i++) {
        if (originals.indexOf(originals[i] - 2) >= 0) lineNumbers.push(originals[i] - 1);
    }
    lineNumbers.sort((a, b) => a - b);
    const last = lineNumbers[lineNumbers.length - 1] ?? 1;
    const lineNumberWidth = chatWidth(String(last));
    const vLineWidth = chatWidth("|");
    const contentX = lineNumberWidth + vLineWidth + spaceWidth() * 2;
    const contentWidth = Math.max(1, maxWidth - contentX);
    for (let i = 0; i < lineNumbers.length; i++) {
        const lineNumber = lineNumbers[i];
        const y = canvas.getHeight();
        canvas.addElement(0, y, new TextLayoutText("&9" + String(lineNumber)));
        canvas.addElement(
            contentX,
            y,
            snippetLineChunks(
                file,
                lineNumber,
                byLine.get(lineNumber) ?? [],
                contentWidth
            )
        );
    }
    canvas.addElement(lineNumberWidth + spaceWidth(), 0, new TextLayoutVLine(canvas.getHeight(), "&7|"));
    return canvas;
}

function diagnosticElement(
    sm: SourceMap,
    diagnostic: Diagnostic,
    maxWidth: number,
    isPrimary: boolean,
    displayPath: (path: string) => string
): TextLayoutVStack {
    const stack = new TextLayoutVStack();
    stack.add(new TextLayoutText(
        `${LEVEL_COLORS[diagnostic.level]}&l${LEVEL_NAMES[diagnostic.level]}&7: `
        + `${isPrimary ? "&f&l" : "&f"}${diagnostic.message}`
    ));
    const snippet = new TextLayoutVStack();
    const byFile = spansByFileAndLine(sm, diagnostic);
    for (const [file, byLine] of byFile.entries()) {
        const spans: DiagnosticLineSpan[] = [];
        for (const lineSpans of byLine.values()) {
            for (let i = 0; i < lineSpans.length; i++) spans.push(lineSpans[i]);
        }
        const primary = spans.find((span) => span.kind === "primary") ?? spans[0];
        if (primary !== undefined) {
            snippet.add(new TextLayoutText("&7" + locationLine(
                displayPath(file.path),
                primary.line,
                primary.startColumn + 1,
                maxWidth
            )));
            snippet.add(snippetLines(file, byLine, maxWidth));
        }
    }
    stack.add(new TextLayoutTruncate(snippet, maxWidth));
    for (let i = 0; i < diagnostic.subDiagnostics.length; i++) {
        stack.add(diagnosticElement(
            sm,
            diagnostic.subDiagnostics[i],
            maxWidth,
            false,
            displayPath
        ));
    }
    return stack;
}

export function formatDiagnostic(
    sourceMap: SourceMap,
    diagnostic: Diagnostic,
    maxWidth: number,
    displayPath: (path: string) => string = (path) => path
): FormattedTextBlock {
    return renderTextBlock(diagnosticElement(
        sourceMap,
        diagnostic,
        maxWidth,
        true,
        displayPath
    ));
}

export function formatDiagnostics(
    sourceMap: SourceMap,
    diagnostics: readonly Diagnostic[],
    maxWidth: number,
    displayPath: (path: string) => string = (path) => path
): FormattedTextBlock {
    const stack = new TextLayoutVStack();
    for (let i = 0; i < diagnostics.length; i++) {
        if (i > 0) stack.add(new TextLayoutText(""));
        stack.add(diagnosticElement(
            sourceMap,
            diagnostics[i],
            maxWidth,
            true,
            displayPath
        ));
    }
    return renderTextBlock(stack);
}

export type { FormattedTextBlock } from "./textLayout";
