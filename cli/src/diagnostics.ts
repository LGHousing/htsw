import * as htsw from "htsw";

import { ansi, type AnsiColor } from "./ansi";

type SpanWithMeta = htsw.DiagnosticSpan & {
    file: htsw.SourceFile;
    startLine: number;
    startCol: number;
    endLine: number;
    endCol: number;
};

export function printDiagnostic(sourceMap: htsw.SourceMap, diagnostic: htsw.Diagnostic): void {
    console.error(
        `${ansi(levelColor(diagnostic.level), diagnostic.level, true)}: ${diagnostic.message}`,
    );

    const groupedSpans = groupSpansByFile(sourceMap, diagnostic.spans);
    for (const [, spans] of groupedSpans) {
        printFileSnippet(spans, diagnostic.level);
    }

    for (const sub of diagnostic.subDiagnostics) {
        printSubDiagnostic(sourceMap, sub);
    }
}

function printSubDiagnostic(sourceMap: htsw.SourceMap, diagnostic: htsw.Diagnostic): void {
    console.error(`${ansi(levelColor(diagnostic.level), diagnostic.level, true)}: ${diagnostic.message}`);
    const groupedSpans = groupSpansByFile(sourceMap, diagnostic.spans);
    for (const [, spans] of groupedSpans) {
        printFileSnippet(spans, diagnostic.level);
    }

    for (const sub of diagnostic.subDiagnostics) {
        printSubDiagnostic(sourceMap, sub);
    }
}

function groupSpansByFile(
    sourceMap: htsw.SourceMap,
    spans: htsw.DiagnosticSpan[],
): Map<string, SpanWithMeta[]> {
    const grouped = new Map<string, SpanWithMeta[]>();
    for (const ds of spans) {
        try {
            const file = sourceMap.getFileByPos(ds.span.start);
            const start = file.getPosition(ds.span.start);
            const rawEndPos = Math.max(ds.span.start + 1, ds.span.end);
            const end = file.getPosition(rawEndPos);
            const entry: SpanWithMeta = {
                ...ds,
                file,
                startLine: start.line,
                startCol: start.column,
                endLine: end.line,
                endCol: Math.max(start.column, end.column),
            };

            const key = file.path;
            if (!grouped.has(key)) grouped.set(key, []);
            grouped.get(key)!.push(entry);
        } catch {
            // Best effort only.
        }
    }
    return grouped;
}

function printFileSnippet(spans: SpanWithMeta[], level: htsw.DiagnosticLevel): void {
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
    console.error(
        `${" ".repeat(width)}${ansi("blue", "-->")} ${primary.file.path}:${primary.startLine}:${primary.startCol}`,
    );
    console.error(`${" ".repeat(width + 1)}${ansi("blue", "|")}`);

    for (const lineNumber of lineNumbers) {
        const line = primary.file.getLine(lineNumber);
        const lineSpans = spans.filter((it) => lineNumber >= it.startLine && lineNumber <= it.endLine);
        console.error(`${String(lineNumber).padStart(width)} ${ansi("blue", "|")} ${line}`);

        if (lineSpans.length === 0) continue;
        const annotationRows = buildAnnotationRows(line, lineNumber, lineSpans, level);
        for (const row of annotationRows) {
            if (!rowHasContent(row)) continue;
            console.error(`${" ".repeat(width)} ${ansi("blue", "|")} ${renderRow(row)}`);
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
    const lineEnd = line.length;

    const sortedSpans = [...lineSpans].sort((a, b) => a.span.start - b.span.start).reverse();
    for (const span of sortedSpans) {
        const startX = lineNumber === span.startLine ? Math.max(0, span.startCol - 1) : 0;
        const endXExclusive = lineNumber === span.endLine
            ? Math.max(startX + 1, span.endCol - 1)
            : Math.max(startX + 1, lineEnd);
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
    let activeColor: AnsiColor | null = null;
    for (let i = 0; i <= end; i++) {
        const cell = row[i];
        if (cell.color !== activeColor) {
            if (activeColor !== null) out += "\u001b[0m";
            if (cell.color !== null) out += openAnsi(cell.color);
            activeColor = cell.color;
        }
        out += cell.ch;
    }
    if (activeColor !== null) out += "\u001b[0m";
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

function openAnsi(color: AnsiColor): string {
    if (color === "red") return "\u001b[31m";
    if (color === "yellow") return "\u001b[33m";
    if (color === "blue") return "\u001b[34m";
    return "\u001b[32m";
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
