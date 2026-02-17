import * as htsw from "../src";

import { describe } from "vitest";

class FakeFileLoader implements htsw.FileLoader {
    fileExists(path: string): boolean {
        return true;
    }
    readFile(path: string): string {
        return `var x += 1.0
var x += 1
        `;
    }
}

describe("Main", () => {
    const fileLoader = new FakeFileLoader();
    const sm = new htsw.SourceMap(fileLoader);

    const gcx = new htsw.GlobalCtxt(sm);
    const tcx = htsw.TyCtxt.fromGlobalCtxt(gcx);
    
    const actions = htsw.htsl.parseHtsl(gcx, "test.htsl");

    htsw.check(tcx, actions);

    console.log(actions);
    //console.log(gcx.diagnostics);

    for (const diagnostic of gcx.diagnostics) {
        console.log("A");
        console.log(printDiagnostic(sm, diagnostic));
    }
});

function computeLineAndColumn(file: htsw.SourceFile, pos: number): { line: number, col: number } {
    let line = 1;
    let col = 1;

    for (let i = file.startPos; i < pos && i < file.endPosition(); i++) {
        const ch = file.src[i - file.startPos];
        if (ch === "\n") {
            line++;
            col = 1;
        } else {
            col++;
        }
    }
    return { line, col };
}

function underlineLine(line: string, startCol: number, endCol: number, char: string): string {
    let s = "";
    for (let i = 1; i < startCol; i++) s += " ";
    for (let i = startCol; i <= endCol; i++) s += char;
    return s;
}

export function printDiagnostic(map: htsw.SourceMap, diag: htsw.Diagnostic): string {
    const lines: string[] = [];

    // Header
    lines.push(`${diag.level}: ${diag.message}`);

    // We might have multiple labels/references for the same line — group per file/line
    interface LineInfo {
        file: htsw.SourceFile;
        line: number;
        source: string;
        marks: { start: number; end: number; char: string; text?: string }[];
    }

    const grouped: Map<string, LineInfo> = new Map();

    const addMark = (span: htsw.Span, char: string, text?: string) => {
        const file = map.getFileByPos(span.start);
        const { line, col } = computeLineAndColumn(file, span.start);
        const key = `${file.path}:${line}`;

        let info = grouped.get(key);
        if (!info) {
            info = {
                file,
                line,
                source: file.getLine(line),
                marks: []
            };
            grouped.set(key, info);
        }

        // end is exclusive
        const length = span.end - span.start;
        const startCol = col;
        const endCol = col + Math.max(0, length - 1);

        info.marks.push({ start: startCol, end: endCol, char, text });
    };

    for (const part of diag.parts) {
        switch (part.kind) {
            case "label":
                addMark(part.span, "^", part.text);
                break;
            case "reference":
                addMark(part.span, "-", part.text);
                break;
            case "edit":
                for (const edit of part.edits) {
                    const file = map.getFileByPos(edit.span.start);
                    const { line, col } = computeLineAndColumn(file, edit.span.start);
                    lines.push(
                        `  help: consider replacing text at ${file.path}:${line}:${col} with "${edit.text}"`
                    );
                }
                break;
            case "note":
                lines.push(`  note: ${part.text}`);
                break;
            case "hint":
                lines.push(`  hint: ${part.text}`);
                break;
        }
    }

    // Print grouped label/reference sections
    for (const info of grouped.values()) {
        const { file, line, source, marks } = info;
        lines.push(`  --> ${file.path}:${line}`);

        // line number display
        lines.push(`   ${line} | ${source}`);

        // underline line(s)
        for (const mark of marks) {
            const underline = underlineLine(source, mark.start, mark.end, mark.char);
            const text = mark.text ? ` ${mark.text}` : "";
            lines.push(`     | ${underline}${text}`);
        }
    }

    return lines.join("\n");
}