import type { Diagnostic, DiagnosticLevel, DiagnosticSpan, SourceFile, SourceMap } from "htsw";

export type DiagnosticLineSpan = {
    rootDiagnostic: Diagnostic;
    diagnostic: Diagnostic;
    kind: "primary" | "secondary";
    level: DiagnosticLevel;
    label?: string;
    file: SourceFile;
    line: number;
    startColumn: number;
    endColumn: number;
    order: number;
};

function lineEndColumn(file: SourceFile, line: number): number {
    return file.getLine(line).replace(/\r$/, "").length;
}

function normalizeSpan(
    sm: SourceMap,
    rootDiagnostic: Diagnostic,
    diagnostic: Diagnostic,
    span: DiagnosticSpan,
    order: number
): DiagnosticLineSpan[] {
    let file: SourceFile;
    try {
        file = sm.getFileByPos(span.span.start);
    } catch (_e) {
        const files = sm.sourceFiles;
        const atEnd = files.length > 0 ? files[files.length - 1] : undefined;
        if (atEnd === undefined || span.span.start !== atEnd.endPos()) return [];
        file = atEnd;
    }
    const start = file.getPosition(span.span.start);
    const endPos = Math.max(span.span.start, span.span.end);
    const end = file.getPosition(Math.min(endPos, file.endPos()));
    const lastLine = end.line > start.line && end.column === 1 ? end.line - 1 : end.line;
    const out: DiagnosticLineSpan[] = [];
    for (let line = start.line; line <= lastLine; line++) {
        const lineLength = lineEndColumn(file, line);
        const startColumn = line === start.line ? Math.max(0, start.column - 1) : 0;
        let endColumn = line === end.line ? Math.max(0, end.column - 1) : lineLength;
        endColumn = Math.min(lineLength, endColumn);
        const clampedStart = Math.min(lineLength, startColumn);
        if (endColumn <= clampedStart) endColumn = Math.min(lineLength, clampedStart + 1);
        if (endColumn <= clampedStart) endColumn = clampedStart + 1;
        out.push({
            rootDiagnostic,
            diagnostic,
            kind: span.kind,
            level: diagnostic.level,
            label: line === start.line ? span.label : undefined,
            file,
            line,
            startColumn: clampedStart,
            endColumn,
            order,
        });
    }
    return out;
}

export function normalizeDiagnosticSpans(
    sm: SourceMap,
    diagnostics: readonly Diagnostic[]
): DiagnosticLineSpan[] {
    const out: DiagnosticLineSpan[] = [];
    let order = 0;
    const visit = (root: Diagnostic, diagnostic: Diagnostic): void => {
        for (let i = 0; i < diagnostic.spans.length; i++) {
            const normalized = normalizeSpan(sm, root, diagnostic, diagnostic.spans[i], order++);
            for (let j = 0; j < normalized.length; j++) out.push(normalized[j]);
        }
        for (let i = 0; i < diagnostic.subDiagnostics.length; i++) {
            visit(root, diagnostic.subDiagnostics[i]);
        }
    };
    for (let i = 0; i < diagnostics.length; i++) visit(diagnostics[i], diagnostics[i]);
    return out;
}
