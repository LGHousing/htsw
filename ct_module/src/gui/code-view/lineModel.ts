/// <reference types="../../../CTAutocomplete" />

import { FileSystemFileLoader } from "../../utils/files";
import { actionsToLines, parseHtslFile, type HtslLine } from "../state/htsl-render";
import { getParsedResult } from "../state";
import { tokenizeHtsl, type SyntaxToken } from "../right-panel/syntax";
import type { FieldSpan, RenderableLine, TokenSpan } from "./types";

const COLOR_PLAIN = 0xffe5e5e5 | 0;
const COLOR_ERROR = 0xffe85c5c | 0;
const COLOR_GUTTER = 0xff666666 | 0;
const DIAG_ERROR_BG = 0x40e85c5c | 0;
const DIAG_WARN_BG = 0x40e5bc4b | 0;

/** Decorator-supplied input that influences tokenization (e.g. which fields underline). */
export type LineModelOptions = {
    /**
     * Optional render-time hint: only generate enough lines to cover this
     * many around the focused line. When undefined, returns the full file.
     */
    focus?: { actionPath: string; before: number; after: number } | null;
};

/** Lift plain syntax tokens into `TokenSpan`s, attaching field-span tags when known. */
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

/** Diagnostic backgrounds keyed by 1-based line number for the active file. */
function diagBackgroundsForFile(path: string): Map<number, number> {
    const out = new Map<number, number>();
    const parsed = getParsedResult();
    if (parsed === null) return out;
    const sm = parsed.gcx.sourceMap;
    const norm = path.replace(/\\/g, "/");
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
            if (file.path.replace(/\\/g, "/") !== norm) continue;
            const startLine = file.getPosition(span.start).line;
            const endLine = file.getPosition(span.end).line;
            for (let ln = startLine; ln <= endLine; ln++) {
                const prev = out.get(ln);
                // Error wins over warning.
                if (!prev || (isError && prev === DIAG_WARN_BG)) out.set(ln, bg);
            }
        }
    }
    return out;
}

function endsWith(s: string, suffix: string): boolean {
    return s.length >= suffix.length && s.lastIndexOf(suffix) === s.length - suffix.length;
}

/** Strip MC-root absolute path prefixes from error message text before display. */
let cachedMcRoot: string | null = null;
function mcRootForward(): string {
    if (cachedMcRoot !== null) return cachedMcRoot;
    try {
        // @ts-ignore
        const Paths = Java.type("java.nio.file.Paths");
        cachedMcRoot = String(
            Paths.get(".").toAbsolutePath().normalize().toString()
        ).replace(/\\/g, "/");
    } catch (_e) {
        cachedMcRoot = "";
    }
    return cachedMcRoot;
}

function shortenForDisplay(text: string, maxLen: number): string {
    let s = text;
    const root = mcRootForward();
    if (root.length > 0) {
        const rootBack = root.replace(/\//g, "\\\\");
        s = s.split(`${root}/`).join("./");
        s = s.split(`${root}\\`).join("./");
        s = s.split(rootBack).join("./");
    }
    if (s.length > maxLen) {
        return `${s.substring(0, maxLen - 1)}…`;
    }
    return s;
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

/** Build RenderableLines for an .htsl file. */
function htslRenderableLines(path: string): RenderableLine[] {
    const parsed = parseHtslFile(path);
    if (parsed.parseError !== null) {
        const out: RenderableLine[] = [
            syntheticLine("__parse_err_head", "// parse failed", COLOR_ERROR),
        ];
        const errLines = parsed.parseError.split("\n");
        for (let i = 0; i < errLines.length; i++) {
            out.push(
                syntheticLine(
                    `__parse_err_${i}`,
                    shortenForDisplay(errLines[i], 60),
                    COLOR_ERROR
                )
            );
        }
        return out;
    }
    const lines = actionsToLines(parsed.actions);
    if (lines.length === 0) {
        return [
            syntheticLine("__empty", "// (empty function)", COLOR_GUTTER),
        ];
    }
    const out: RenderableLine[] = [];
    // For multi-line actions (CONDITIONAL/RANDOM), several rendered lines share
    // the same actionPath. The FIRST line keeps the canonical id
    // `htsl:<actionPath>` so decorators can target an action by name without
    // needing the line index; continuations get a `:c<n>` suffix to stay
    // unique inside the laid-out element list.
    const seenPaths: { [p: string]: number } = {};
    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        const lineText = indentedText(ln);
        const tokens: TokenSpan[] = attachFieldSpans(
            tokenizeHtsl(lineText),
            ln.fieldSpans
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
        out.push({
            id,
            lineNum: i + 1,
            depth: ln.depth,
            tokens,
            actionPath: ln.actionPath,
        });
    }
    return out;
}

/**
 * Resolve a diff sink's `actionPath` to the canonical first-line id used
 * by the line model. The line model invariant: the first occurrence's id
 * is always `htsl:<actionPath>` (no suffix).
 */
export function lineIdForActionPath(actionPath: string): string {
    return `htsl:${actionPath}`;
}

const fileLoader = new FileSystemFileLoader();
type CachedFile = { mtime: number; lines: string[] };
const plainCache = new Map<string, CachedFile>();

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

/** Build RenderableLines for any non-htsl text file. */
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
            tokens: plainTokens(shortenForDisplay(lines[i], 80), COLOR_PLAIN),
            staticBackground: diags.get(lineNum),
        });
    }
    return out;
}

/**
 * Single entry point for the code view. Dispatches on file extension.
 * Returns an empty list when path is null/empty so callers can render an
 * empty-state directly.
 */
export function linesForFile(path: string | null): RenderableLine[] {
    if (path === null || path.length === 0) return [];
    const norm = path.replace(/\\/g, "/").toLowerCase();
    if (endsWith(norm, ".htsl")) return htslRenderableLines(path);
    return plainTextRenderableLines(path);
}

export const CodeViewColors = {
    plain: COLOR_PLAIN,
    error: COLOR_ERROR,
    gutter: COLOR_GUTTER,
};
