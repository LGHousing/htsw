import * as htsl from "htsl";
import { chatWidth } from "../helpers";

export function printDiagnostic(sm: htsl.SourceMap, diagnostic: htsl.Diagnostic) {
    const { line, column } = sm.positionAt(diagnostic.span.start);
    const content = sm.lineAt(diagnostic.span.start);
    const len = Math.min(
        diagnostic.span.end - diagnostic.span.start,
        content.length - column
    );
    const c = levelColor(diagnostic.level);

    const before = content.substring(0, column);
    const subject = content.substring(column, column + len);
    const after = content.substring(column + len);

    const numberWidth = chatWidth(`${line}`);
    const beforeWidth = chatWidth(before);
    const subjectWidth = chatWidth(subject);
    const spaceWidth = chatWidth(" ");
    const arrowWidth = chatWidth("^");

    ChatLib.chat(`${levelToString(diagnostic.level)}: ${diagnostic.message}`);
    ChatLib.chat(
        `&7${" ".repeat(numberWidth / spaceWidth)}--> source.htsl:${line}:${column}`
    );

    const numSpaces = Math.round(beforeWidth / spaceWidth);
    const numArrows = Math.max(1, Math.round(subjectWidth / arrowWidth));

    const space = `&0${line} &7|`;
    ChatLib.chat(space);
    ChatLib.chat(`&7${line} | &f${before}${c}${subject}&f${after}`);
    ChatLib.chat(`${space}${" ".repeat(numSpaces + 1)}${c}${"^".repeat(numArrows)}`);
}

function levelColor(level: htsl.DiagnosticLevel): string {
    switch (level) {
        case "bug":
            return "&c";
        case "error":
            return "&c";
        case "warning":
            return "&e";
        case "info":
            return "&7";
    }
}

function levelToString(level: htsl.DiagnosticLevel): string {
    switch (level) {
        case "bug":
            return "&c&lbug&r";
        case "error":
            return "&c&lerror&r";
        case "warning":
            return "&e&lwarning&r";
        case "info":
            return "&7&linfo&r";
    }
}
