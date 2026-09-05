import type * as htsw from "htsw";

import { ansi, type AnsiColor } from "./ansi";

type SpanWithMeta = htsw.DiagnosticSpan & {
    file: htsw.SourceFile;
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
};

export function printDiagnostic(sourceMap: htsw.SourceMap, diagnostic: htsw.Diagnostic): void {
    console.error(formatDiagnostic(sourceMap, diagnostic));
}

/** Format a diagnostic and its suggestions without writing to the terminal. */
export function formatDiagnostic(sourceMap: htsw.SourceMap, diagnostic: htsw.Diagnostic): string {
    const lines: string[] = [];
    appendDiagnostic(lines, sourceMap, diagnostic);
    return lines.join("\n");
}

function appendDiagnostic(lines: string[], sourceMap: htsw.SourceMap, diagnostic: htsw.Diagnostic): void {
    lines.push(`${ansi(levelColor(diagnostic.level), diagnostic.level, true)}: ${diagnostic.message}`);
    for (const spans of groupSpansByFile(sourceMap, diagnostic.spans).values()) {
        appendFileSnippet(lines, spans, diagnostic.level);
    }
    appendEdits(lines, sourceMap, diagnostic.edits);
    for (const sub of diagnostic.subDiagnostics) appendDiagnostic(lines, sourceMap, sub);
}

/** Invalid or cross-file ranges must not hide the rest of a diagnostic. */
function resolveFile(sourceMap: htsw.SourceMap, span: htsw.Span): htsw.SourceFile | undefined {
    if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.end < span.start) return;
    try {
        const file = sourceMap.getFileByPos(span.start);
        if (span.end <= file.endPos()) return file;
    } catch {
        // Synthetic diagnostics can have no source location.
    }
}

function appendLocation(lines: string[], file: htsw.SourceFile, line: number, column: number, width: number): void {
    lines.push(`${" ".repeat(width)}${ansi("blue", "-->")} "${file.path}":${line}:${column}`);
    lines.push(`${" ".repeat(width + 1)}${ansi("blue", "|")}`);
}

function appendEdits(lines: string[], sourceMap: htsw.SourceMap, edits: htsw.DiagnosticEdit[]): void {
    const byFile = new Map<htsw.SourceFile, htsw.DiagnosticEdit[]>();
    for (const edit of edits) {
        const file = resolveFile(sourceMap, edit.span);
        if (!file || file.src.slice(edit.span.start - file.startPos, edit.span.end - file.startPos) === edit.text) continue;
        if (!byFile.has(file)) byFile.set(file, []);
        byFile.get(file)!.push(edit);
    }
    for (const [file, fileEdits] of byFile) {
        fileEdits.sort((a, b) => a.span.start - b.span.start || a.span.end - b.span.end);
        let group: htsw.DiagnosticEdit[] = [];
        let endLine = 0;
        for (const edit of fileEdits) {
            const start = file.getPosition(edit.span.start);
            const previous = group[group.length - 1];
            // Share a preview when edits touch the same source lines. Conflicting
            // ranges cannot be applied together, so show them separately.
            if (previous && (start.line > endLine || edit.span.start < previous.span.end)) {
                appendEditSnippet(lines, file, group);
                group = [];
            }
            group.push(edit);
            endLine = file.getPosition(edit.span.end).line;
        }
        if (group.length) appendEditSnippet(lines, file, group);
    }
}

function appendEditSnippet(lines: string[], file: htsw.SourceFile, edits: htsw.DiagnosticEdit[]): void {
    const start = file.getPosition(edits[0].span.start);
    const end = file.getPosition(edits[edits.length - 1].span.end);
    const lineStart = file.getLineStartPos(start.line) - file.startPos;
    const lineEnd = file.getLineStartPos(end.line) - file.startPos + file.getLine(end.line).length;
    const markers: { start: number; end: number }[] = [];
    let after = "";
    let cursor = lineStart;
    // Read offsets from the original source, but record markers in the edited
    // text so earlier insertions/deletions also move later markers correctly.
    for (const edit of edits) {
        after += file.src.slice(cursor, edit.span.start - file.startPos);
        const markerStart = after.length;
        after += edit.text;
        markers.push({ start: markerStart, end: after.length });
        cursor = edit.span.end - file.startPos;
    }
    after += file.src.slice(cursor, lineEnd);
    const newLines = after.split("\n");
    const width = String(start.line + newLines.length - 1).length;
    appendLocation(lines, file, start.line, start.column, width);
    let offset = 0;
    for (const [index, line] of newLines.entries()) {
        lines.push(`${String(start.line + index).padStart(width)} ${ansi("blue", "|")} ${displayLine(line)}`);
        const rows: Cell[][] = [];
        const deletions: number[] = [];
        for (const marker of markers) {
            const deletion = marker.start === marker.end;
            const touched = deletion
                ? marker.start >= offset && marker.start <= offset + line.length
                : marker.start <= offset + line.length && marker.end > offset;
            if (!touched) continue;
            const from = displayLine(line.slice(0, Math.max(0, marker.start - offset))).length;
            const to = displayLine(line.slice(0, Math.max(0, marker.end - offset))).length;
            if (deletion) deletions.push(from);
            else drawHLine(rows, 0, from, Math.max(from + 1, to), "+", "green");
        }
        for (const from of deletions) drawText(rows, rows.length, from, "- removed here", "green");
        for (const row of rows) {
            lines.push(`${" ".repeat(width)} ${ansi("blue", "|")} ${renderRow(row)}`);
        }
        offset += line.length + 1;
    }
}

function displayLine(line: string): string {
    return line.replace(/\r$/, "").replace(/\t/g, "    ");
}

function groupSpansByFile(
    sourceMap: htsw.SourceMap,
    spans: htsw.DiagnosticSpan[],
): Map<string, SpanWithMeta[]> {
    const grouped = new Map<string, SpanWithMeta[]>();
    for (const ds of spans) {
        const file = resolveFile(sourceMap, ds.span);
        if (!file) continue;
        const start = file.getPosition(ds.span.start);
        // Spans are half-open; an end at the next line's start does not touch that line.
        const last = file.getPosition(Math.max(ds.span.start, ds.span.end - 1));
        const end = file.getPosition(ds.span.end);
        const entry: SpanWithMeta = {
            ...ds,
            file,
            startLine: start.line,
            startCol: start.column,
            endLine: last.line,
            endCol: end.line === last.line ? end.column : file.getLine(last.line).length + 1,
        };

        const key = file.path;
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(entry);
    }
    return grouped;
}

function appendFileSnippet(lines: string[], spans: SpanWithMeta[], level: htsw.DiagnosticLevel): void {
    if (spans.length === 0) return;

    const touched = new Set<number>();
    for (const span of spans) {
        for (let line = span.startLine; line <= span.endLine; line++) touched.add(line);
    }

    const lineNumbers = [...touched].sort((a, b) => a - b);
    for (let i = 1; i < lineNumbers.length; i++) {
        if (lineNumbers[i] - lineNumbers[i - 1] === 2) {
            lineNumbers.splice(i, 0, lineNumbers[i - 1] + 1);
            i++;
        }
    }

    const primary = spans.find((it) => it.kind === "primary") ?? spans[0];
    const width = String(lineNumbers[lineNumbers.length - 1] ?? 1).length;
    appendLocation(lines, primary.file, primary.startLine, primary.startCol, width);

    let previousLine = 0;
    for (const lineNumber of lineNumbers) {
        if (previousLine && lineNumber > previousLine + 1) {
            lines.push(`${" ".repeat(width)} ${ansi("blue", "|")} ...`);
        }
        previousLine = lineNumber;
        const line = primary.file.getLine(lineNumber).replace(/\r$/, "");
        const lineSpans = spans.filter((it) => lineNumber >= it.startLine && lineNumber <= it.endLine);
        lines.push(`${String(lineNumber).padStart(width)} ${ansi("blue", "|")} ${displayLine(line)}`);

        if (lineSpans.length === 0) continue;
        const annotationRows = buildAnnotationRows(line, lineNumber, lineSpans, level);
        for (const row of annotationRows) {
            if (!rowHasContent(row)) continue;
            lines.push(`${" ".repeat(width)} ${ansi("blue", "|")} ${renderRow(row)}`);
        }
    }
}

type Cell = { ch: string; color: AnsiColor | null };

function buildAnnotationRows(
    line: string,
    lineNumber: number,
    lineSpans: SpanWithMeta[],
    level: htsw.DiagnosticLevel,
): Cell[][] {
    const rows: Cell[][] = [];
    const occupation: number[] = [];

    const sortedSpans = [...lineSpans].sort((a, b) => a.span.start - b.span.start).reverse();
    for (const span of sortedSpans) {
        const startColumn = lineNumber === span.startLine ? Math.max(0, span.startCol - 1) : 0;
        const startX = displayLine(line.slice(0, startColumn)).length;
        const endXExclusive = lineNumber === span.endLine
            ? Math.max(startX + 1, displayLine(line.slice(0, span.endCol - 1)).length)
            : Math.max(startX + 1, displayLine(line).length);
        const color = span.kind === "primary" ? levelColor(level) : "blue";
        const underline = span.kind === "primary" ? markerChar(level, span.kind) : "-";

        drawHLine(rows, 0, startX, endXExclusive, underline, color);

        if (!span.label) {
            setOccupation(occupation, 0, startX);
            continue;
        }

        const label = span.label;
        const labelWidth = label.length;
        const inlineX = endXExclusive + 1;

        if (inlineX + labelWidth < getLastX(occupation, 0)) {
            drawText(rows, 0, inlineX, label, color);
            setOccupation(occupation, 0, startX);
            continue;
        }

        let lane = 1;
        const stackedLabelX = startX;
        while (stackedLabelX + labelWidth >= getLastX(occupation, lane)) {
            lane++;
        }

        for (let i = 0; i <= lane; i++) {
            setOccupation(occupation, i, startX);
        }

        drawVLine(rows, 1, 1 + lane, startX, "|", color);
        drawText(rows, 1 + lane, stackedLabelX, label, color);
    }

    return rows;
}

function drawHLine(
    rows: Cell[][],
    y: number,
    xStart: number,
    xEndExclusive: number,
    ch: string,
    color: AnsiColor,
): void {
    const from = Math.max(0, xStart);
    const to = Math.max(from + 1, xEndExclusive);
    for (let x = from; x < to; x++) {
        setCell(rows, y, x, ch, color);
    }
}

function drawVLine(
    rows: Cell[][],
    yStart: number,
    yEndExclusive: number,
    x: number,
    ch: string,
    color: AnsiColor,
): void {
    for (let y = yStart; y < yEndExclusive; y++) {
        setCell(rows, y, x, ch, color);
    }
}

function drawText(
    rows: Cell[][],
    y: number,
    x: number,
    text: string,
    color: AnsiColor,
): void {
    for (let i = 0; i < text.length; i++) {
        setCell(rows, y, x + i, text[i], color);
    }
}

function setCell(rows: Cell[][], y: number, x: number, ch: string, color: AnsiColor): void {
    while (rows.length <= y) rows.push([]);
    const row = rows[y];
    while (row.length <= x) row.push({ ch: " ", color: null });
    row[x] = { ch, color };
}

function renderRow(row: Cell[]): string {
    let end = row.length - 1;
    while (end >= 0 && row[end].ch === " ") end--;
    if (end < 0) return "";

    let out = "";
    for (let start = 0; start <= end;) {
        const color = row[start].color;
        let next = start + 1;
        while (next <= end && row[next].color === color) next++;
        const text = row.slice(start, next).map((cell) => cell.ch).join("");
        out += color === null ? text : ansi(color, text);
        start = next;
    }
    return out;
}

function rowHasContent(row: Cell[]): boolean {
    return row.some((it) => it.ch !== " ");
}

function getLastX(occupation: number[], lane: number): number {
    return occupation[lane] ?? Infinity;
}

function setOccupation(occupation: number[], lane: number, x: number): void {
    const curr = occupation[lane];
    occupation[lane] = curr === undefined ? x : Math.min(curr, x);
}

function markerChar(level: htsw.DiagnosticLevel, kind: htsw.DiagnosticSpan["kind"]): string {
    if (kind === "secondary") return "-";
    if (level === "warning") return "~";
    if (level === "note") return "-";
    if (level === "help") return "+";
    return "^";
}

function levelColor(level: htsw.DiagnosticLevel): AnsiColor {
    if (level === "bug" || level === "error") return "red";
    if (level === "warning") return "yellow";
    if (level === "note") return "blue";
    return "green";
}
