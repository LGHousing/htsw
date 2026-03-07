import { Diagnostic, DiagnosticLevel, DiagnosticSpan, SourceFile, SourceMap } from "htsw";

import { printUI, UIElementCanvas, UIElementHLine, UIElementText, UIElementTruncate, UIElementVLine, UIElementVStack } from ".";
import { chatWidth, spaceWidth } from "../utils/helpers";

export function printDiagnostics(sm: SourceMap, diags: Diagnostic[]) {
    for (let i = 0; i < diags.length; i++) {
        if (i !== 0) ChatLib.chat("");
        printDiagnostic(sm, diags[i]);
    }
}

export function printDiagnostic(sm: SourceMap, diag: Diagnostic) {
    printUI(new UIElementDiagnostic(sm, diag));
}

export const DIAGNOSTIC_LEVEL_NAMES: {
    [key in DiagnosticLevel]: string;
} = {
    bug: "bug",
    error: "error",
    warning: "warning",
    note: "note",
    help: "help",
};

export const DIAGNOSTIC_LEVEL_COLORS: {
    [key in DiagnosticLevel]: string;
} = {
    bug: "&4",
    error: "&c",
    warning: "&e",
    note: "&9",
    help: "&a",
};

export const DIAGNOSTIC_LEVEL_UNDERLINE_CHARS: {
    [key in DiagnosticLevel]: string;
} = {
    bug: "^",
    error: "^",
    warning: "~",
    note: "-",
    help: "+"
}

export class UIElementDiagnostic extends UIElementVStack {
    constructor(sm: SourceMap, diag: Diagnostic, isPrimary: boolean = true) {
        super();

        const diagLevelName = DIAGNOSTIC_LEVEL_NAMES[diag.level];
        const diagLevelColor = DIAGNOSTIC_LEVEL_COLORS[diag.level];

        const messageColor = isPrimary ? "&f&l" : "&f";

        this.add(new UIElementText(`${diagLevelColor}&l${diagLevelName}&7: ${messageColor}${diag.message}`));
        this.add(new UIElementTruncate(
            new UIElementSnippet(sm, diag.spans, diag.level),
            ChatLib.getChatWidth(),
        ));

        for (const subDiag of diag.subDiagnostics) {
            this.add(new UIElementDiagnostic(sm, subDiag, false));
        }
    }
}

export class UIElementSnippet extends UIElementVStack {
    constructor(
        sm: SourceMap,
        spans: DiagnosticSpan[],
        level: DiagnosticLevel
    ) {
        super();

        const files = new Map<SourceFile, DiagnosticSpan[]>();
        for (const ds of spans) {
            const file = sm.getFileByPos(ds.span.start);

            if (!files.has(file)) {
                files.set(file, []);
            }
            files.get(file)!.push(ds);
        }

        for (const [file, spans] of files.entries()) {
            const startPos = spans.find(
                it => it.kind === "primary"
            )?.span.start ?? spans[0].span.start;

            const { line, column } = file.getPosition(startPos);

            this.add(new UIElementText(`&7 --> ${file.path}:${line}:${column}`));
            this.add(new UIElementSnippetLines(file, spans, level));
        }
    }
}

export class UIElementSnippetLines extends UIElementCanvas {
    constructor(
        file: SourceFile,
        spans: DiagnosticSpan[],
        level: DiagnosticLevel,
    ) {
        super();

        const lines = new Map<number, DiagnosticSpan[]>();
        for (const ds of spans) {
            const { line } = file.getPosition(ds.span.start);

            if (!lines.has(line)) {
                lines.set(line, []);
            }
            lines.get(line)!.push(ds);
        }

        // Have to do this restarted stuff cuz of CT
        let lineNumbers: number[] = []
        for (const lineNumber of lines.keys()) {
            lineNumbers.push(lineNumber);
        }

        // fill in small gaps
        for (const lineNumber of lineNumbers) {
            if (lineNumbers.find(it => it === lineNumber - 2)) {
                lineNumbers.push(lineNumber - 1);
            }
        }

        lineNumbers.sort();

        const lineNumberWidth = chatWidth(lineNumbers[lineNumbers.length - 1].toString());
        const vLineWidth = chatWidth("|");

        for (const lineNumber of lineNumbers) {
            const lineY = this.getHeight();
            const lineContent = file.getLine(lineNumber);
            const lineStartPos = file.getLineStartPos(lineNumber);
            const lineSpans = lines.get(lineNumber) ?? [];

            this.addElement(0, lineY, new UIElementText("&9" + lineNumber.toString()));
            this.addElement(
                lineNumberWidth + vLineWidth + spaceWidth() * 2, lineY,
                new UIElementSnippetLine(lineContent, lineStartPos, lineSpans, level)
            );
        }

        // divider
        this.addElement(lineNumberWidth + spaceWidth(), 0, new UIElementVLine(this.getHeight(), "&7|"));
    }
}

export class UIElementSnippetLine extends UIElementCanvas {
    constructor(
        lineContent: string,
        lineStartPos: number,
        spans: DiagnosticSpan[],
        level: DiagnosticLevel
    ) {
        super();

        const color = DIAGNOSTIC_LEVEL_COLORS[level];
        const ulChar = DIAGNOSTIC_LEVEL_UNDERLINE_CHARS[level];

        this.addElement(0, 0, new UIElementText("&7" + lineContent));

        const occupation: number[] = [];
        const getLastX = (line: number) => occupation[line] ?? Infinity;

        spans.sort((a, b) => a.span.start - b.span.start);
        for (const ds of [...spans].reverse()) {
            const underlineX = chatWidth(lineContent.slice(0, ds.span.start - lineStartPos));
            const underlineWidth = chatWidth(lineContent.slice(
                ds.span.start - lineStartPos, ds.span.end - lineStartPos
            ));
            const underlineChar = ds.kind === "primary" ? `${color}${ulChar}` : "&9-";
            const vLineChar = ds.kind === "primary" ? `${color}|` : "&9|";
            const labelColor = ds.kind === "primary" ? color : "&9";

            // console.log(underlineWidth, chatWidth(underlineChar));

            // add underline
            this.addElement(underlineX, 1, new UIElementHLine(underlineWidth, underlineChar, labelColor));
            if (!ds.label) {
                occupation[0] = underlineX;
                continue;
            }

            const labelWidth = chatWidth(ds.label);

            // see if we can fit the label inline
            if (underlineX + underlineWidth + spaceWidth() + labelWidth < getLastX(0)) {
                this.addElement(underlineX + underlineWidth + spaceWidth(), 1, new UIElementText(labelColor + ds.label));
                occupation[0] = underlineX;
                continue;
            }

            // otherwise find the first line it fits on
            let line = 1;
            while (true) {
                if (underlineX + labelWidth < getLastX(line)) break;
                line++;
            }
            for (let i = 0; i <= line; i++) occupation[i] = underlineX;

            this.addElement(underlineX, 2, new UIElementVLine(line, vLineChar));
            this.addElement(underlineX, 2 + line, new UIElementText(labelColor + ds.label));
        }
    }
}