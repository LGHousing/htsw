/// <reference types="../../../CTAutocomplete" />

import { FileSystemFileLoader } from "../../utils/files";
import { actionsToLines, parseHtslFile, type HtslLine } from "../state/htslRender";
import { getParsedResult } from "../state";
import { tokenizeHtsl, type SyntaxToken } from "../right-panel/syntax";
import type { FieldSpan, RenderableLine, TokenSpan } from "./types";

const COLOR_PLAIN = 0xffe5e5e5 | 0;
const COLOR_ERROR = 0xffe85c5c | 0;
const COLOR_GUTTER = 0xff666666 | 0;
const DIAG_ERROR_BG = 0x40e85c5c | 0;
const DIAG_WARN_BG = 0x40e5bc4b | 0;

export type LineModelOptions = {
    focus?: { actionPath: string; before: number; after: number } | null;
};

export function attachFieldSpans(
    tokens: SyntaxToken[],
    fieldSpans: readonly FieldSpan[] | undefined
): TokenSpan[] {
    const out: TokenSpan[] = [];
    let col = 0;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        const start = col;
        const end = col + t.text.length;
        let fieldProp: string | undefined;
        if (fieldSpans !== undefined) {
            for (let j = 0; j < fieldSpans.length; j++) {
                const s = fieldSpans[j];
                if (start >= s.start && end <= s.end) {
                    fieldProp = s.prop;
                    break;
                }
            }
        }
        out.push({ text: t.text, color: t.color, fieldProp });
        col = end;
    }
    return out;
}

function indentedText(line: HtslLine): string {
    let prefix = "";
    for (let i = 0; i < line.depth; i++) prefix += "  ";
    return prefix + line.text;
}

function diagBackgroundsForFile(path: string): Map<number, number> {
    const out = new Map<number, number>();
    const parsed = getParsedResult();
    if (parsed === null) return out;
    const sm = parsed.gcx.sourceMap;
    const norm = path.split("\\").join("/");
    for (let i = 0; i < parsed.diagnostics.length; i++) {
        const d = parsed.diagnostics[i];
        const isError = d.level === "error" || d.level === "bug";
        const isWarn = d.level === "warning";
        if (!isError && !isWarn) continue;
        const bg = isError ? DIAG_ERROR_BG : DIAG_WARN_BG;
        for (let j = 0; j < d.spans.length; j++) {
            const span = d.spans[j].span;
            let file;
            try {
                file = sm.getFileByPos(span.start);
            } catch (_e) {
                continue;
            }
            if (file.path.split("\\").join("/") !== norm) continue;
            const startLine = file.getPosition(span.start).line;
            const endLine = file.getPosition(span.end).line;
            for (let ln = startLine; ln <= endLine; ln++) {
                const prev = out.get(ln);
                if (!prev || (isError && prev === DIAG_WARN_BG)) out.set(ln, bg);
            }
        }
    }
    return out;
}

function endsWith(s: string, suffix: string): boolean {
    return s.length >= suffix.length && s.lastIndexOf(suffix) === s.length - suffix.length;
}

function plainTokens(text: string, color: number): TokenSpan[] {
    return [{ text, color }];
}

function syntheticLine(
    id: string,
    text: string,
    color: number,
    bg?: number
): RenderableLine {
    return {
        id,
        lineNum: 0,
        depth: 0,
        tokens: plainTokens(text, color),
        staticBackground: bg,
        staticForeground: color,
        isHeader: true,
    };
}

const fileLoader = new FileSystemFileLoader();
type CachedFile = { mtime: number; lines: string[] };
const plainCache = new Map<string, CachedFile>();

type HtslCacheEntry = {
    mtime: number;
    parsedRef: object | null;
    lines: RenderableLine[];
};
const htslCache = new Map<string, HtslCacheEntry>();

function getMtimeMs(path: string): number {
    try {
        // @ts-ignore
        const Paths = Java.type("java.nio.file.Paths");
        // @ts-ignore
        const Files = Java.type("java.nio.file.Files");
        return Number(Files.getLastModifiedTime(Paths.get(String(path))).toMillis());
    } catch (_e) {
        return 0;
    }
}

function htslRenderableLines(path: string): RenderableLine[] {
    const mtime = getMtimeMs(path);
    const parsed = getParsedResult();
    const parsedRef: object | null = parsed === null ? null : parsed;
    const cached = htslCache.get(path);
    if (
        cached !== undefined
        && cached.mtime === mtime
        && cached.parsedRef === parsedRef
    ) {
        return cached.lines;
    }

    const result = parseHtslFile(path);
    if (result.parseError !== null) {
        const out: RenderableLine[] = [
            syntheticLine("__parse_err_head", "// parse failed", COLOR_ERROR),
        ];
        const errLines = result.parseError.split("\n");
        for (let i = 0; i < errLines.length; i++) {
            out.push(
                syntheticLine(
                    `__parse_err_${i}`,
                    errLines[i],
                    COLOR_ERROR
                )
            );
        }
        htslCache.set(path, { mtime, parsedRef, lines: out });
        return out;
    }
    const lines = actionsToLines(result.actions);
    if (lines.length === 0) {
        const out = [syntheticLine("__empty", "// (empty function)", COLOR_GUTTER)];
        htslCache.set(path, { mtime, parsedRef, lines: out });
        return out;
    }

    const diags = diagBackgroundsForFile(path);
    const out: RenderableLine[] = [];
    const seenPaths: { [p: string]: number } = {};
    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        const lineText = indentedText(ln);
        // Main's HtslLine has no fieldSpans yet — bucket B (printActionSpans) lands separately.
        // Pass undefined so tokens carry text + color but no per-field metadata.
        const tokens: TokenSpan[] = attachFieldSpans(
            tokenizeHtsl(lineText),
            undefined
        );
        let id: string;
        if (ln.actionPath !== undefined && ln.actionPath.length > 0) {
            const seenAt = seenPaths[ln.actionPath];
            if (seenAt === undefined) {
                seenPaths[ln.actionPath] = i;
                id = `htsl:${ln.actionPath}`;
            } else {
                id = `htsl:${ln.actionPath}:c${i - seenAt}`;
            }
        } else {
            id = `htsl:line${i}`;
        }
        const lineNum = i + 1;
        out.push({
            id,
            lineNum,
            depth: ln.depth,
            tokens,
            actionPath: ln.actionPath,
            staticBackground: diags.get(lineNum),
        });
    }
    htslCache.set(path, { mtime, parsedRef, lines: out });
    return out;
}

export function lineIdForActionPath(actionPath: string): string {
    return `htsl:${actionPath}`;
}

function readPlainLines(path: string): string[] {
    const mtime = getMtimeMs(path);
    const cached = plainCache.get(path);
    if (cached !== undefined && cached.mtime === mtime) return cached.lines;
    let lines: string[] = [];
    try {
        const src = fileLoader.readFile(path);
        lines = src.split("\n");
    } catch (e) {
        lines = [`// failed to read ${path}: ${e}`];
    }
    plainCache.set(path, { mtime, lines });
    return lines;
}

function plainTextRenderableLines(path: string): RenderableLine[] {
    const lines = readPlainLines(path);
    const diags = diagBackgroundsForFile(path);
    const out: RenderableLine[] = [];
    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        out.push({
            id: `plain:${lineNum}`,
            lineNum,
            depth: 0,
            tokens: plainTokens(lines[i], COLOR_PLAIN),
            staticBackground: diags.get(lineNum),
        });
    }
    return out;
}

export function linesForFile(path: string | null): RenderableLine[] {
    if (path === null || path.length === 0) return [];
    const norm = path.split("\\").join("/").toLowerCase();
    if (endsWith(norm, ".htsl")) return htslRenderableLines(path);
    return plainTextRenderableLines(path);
}

export const CodeViewColors = {
    plain: COLOR_PLAIN,
    error: COLOR_ERROR,
    gutter: COLOR_GUTTER,
};
