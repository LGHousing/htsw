/// <reference types="../../../CTAutocomplete" />

import type { Action } from "htsw/types";
import type {
    Diagnostic,
    DiagnosticLevel,
    ImportablesParseResult,
    SourceFile,
    SpanTable,
} from "htsw";

import { getMtimeMs, pathExists } from "../lib/java";
import { shortPath } from "../lib/pathDisplay";
import { FileSystemFileLoader } from "../../utils/fileLoaders";
import {
    actionLineRange,
    actionsToLines,
    parseHtslFile,
    type HtslLine,
} from "./htslParse";
import { getSelectedParsedResult } from "../parsing/selectedParse";
import { getParseAt, onParseCacheEntryChanged } from "../parsing/parses";
import {
    tokenizeHtsl,
    tokenizeJson,
    tokenizeSnbt,
    type SyntaxToken,
} from "../right-panel/syntax";
import type { FieldSpan, RenderableLine, TokenSpan } from "./lineTypes";
import {
    normalizeDiagnosticSpans,
    type DiagnosticLineSpan,
} from "../../diagnostics/spans";
import { ActionListPath, ActionPath } from "../../housingSync/actionPath";

const COLOR_PLAIN = 0xffe5e5e5 | 0;
const COLOR_ERROR = 0xffe85c5c | 0;
const COLOR_GUTTER = 0xff666666 | 0;
const DIAG_ERROR_BG = 0x40e85c5c | 0;
const DIAG_WARN_BG = 0x40e5bc4b | 0;
const DIAG_SECONDARY = 0xff67a7e8 | 0;
const DIAG_UNDERLINE: { [key in DiagnosticLevel]: number } = {
    bug: 0xffb94747 | 0,
    error: COLOR_ERROR,
    warning: 0xffe5bc4b | 0,
    note: DIAG_SECONDARY,
    help: 0xff5cb85c | 0,
};
const DIAG_SEVERITY: { [key in DiagnosticLevel]: number } = {
    bug: 0,
    error: 1,
    warning: 2,
    note: 3,
    help: 4,
};

function attachFieldSpans(
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

type LineDiagnosticInfo = {
    background?: number;
    spans: DiagnosticLineSpan[];
    diagnostics: Diagnostic[];
};

const diagnosticIndexCache = new WeakMap<
    ImportablesParseResult,
    Map<string, Map<number, LineDiagnosticInfo>>
>();

function normalizedPath(path: string): string {
    return path.split("\\").join("/").toLowerCase();
}

function parsedForContext(
    importJsonPath: string | null | undefined
): ImportablesParseResult | null {
    if (
        importJsonPath !== null &&
        importJsonPath !== undefined &&
        importJsonPath !== ""
    ) {
        return getParseAt(importJsonPath)?.parsed ?? null;
    }
    return getSelectedParsedResult();
}

function diagnosticIndexForFile(
    path: string,
    importJsonPath: string | null | undefined
): { parsed: ImportablesParseResult | null; byLine: Map<number, LineDiagnosticInfo> } {
    const empty = new Map<number, LineDiagnosticInfo>();
    const parsed = parsedForContext(importJsonPath);
    if (parsed === null) return { parsed: null, byLine: empty };
    let byFile = diagnosticIndexCache.get(parsed);
    if (byFile === undefined) {
        byFile = new Map();
        const spans = normalizeDiagnosticSpans(parsed.gcx.sourceMap, parsed.diagnostics);
        for (let i = 0; i < spans.length; i++) {
            const span = spans[i];
            const filePath = normalizedPath(span.file.path);
            let byLine = byFile.get(filePath);
            if (byLine === undefined) {
                byLine = new Map();
                byFile.set(filePath, byLine);
            }
            let info = byLine.get(span.line);
            if (info === undefined) {
                info = { spans: [], diagnostics: [] };
                byLine.set(span.line, info);
            }
            info.spans.push(span);
            if (info.diagnostics.indexOf(span.rootDiagnostic) < 0) {
                info.diagnostics.push(span.rootDiagnostic);
            }
            const rootLevel = span.rootDiagnostic.level;
            if (rootLevel === "bug" || rootLevel === "error")
                info.background = DIAG_ERROR_BG;
            else if (rootLevel === "warning" && info.background !== DIAG_ERROR_BG) {
                info.background = DIAG_WARN_BG;
            }
        }
        diagnosticIndexCache.set(parsed, byFile);
    }
    return { parsed, byLine: byFile.get(normalizedPath(path)) ?? empty };
}

function spanWins(a: DiagnosticLineSpan, b: DiagnosticLineSpan): boolean {
    if (a.kind !== b.kind) return a.kind === "primary";
    const severityDiff = DIAG_SEVERITY[a.level] - DIAG_SEVERITY[b.level];
    if (severityDiff !== 0) return severityDiff < 0;
    return a.order < b.order;
}

export function tokensWithDiagnosticSpans(
    tokens: readonly TokenSpan[],
    spans: readonly DiagnosticLineSpan[]
): TokenSpan[] {
    if (spans.length === 0) return tokens.slice();
    const out: TokenSpan[] = [];
    let tokenStart = 0;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const tokenEnd = tokenStart + token.text.length;
        const cuts = [tokenStart, tokenEnd];
        for (let j = 0; j < spans.length; j++) {
            const span = spans[j];
            if (span.startColumn > tokenStart && span.startColumn < tokenEnd)
                cuts.push(span.startColumn);
            if (span.endColumn > tokenStart && span.endColumn < tokenEnd)
                cuts.push(span.endColumn);
        }
        cuts.sort((a, b) => a - b);
        const uniqueCuts: number[] = [];
        for (let j = 0; j < cuts.length; j++) {
            if (j === 0 || cuts[j] !== cuts[j - 1]) uniqueCuts.push(cuts[j]);
        }
        for (let j = 0; j < uniqueCuts.length - 1; j++) {
            const start = uniqueCuts[j];
            const end = uniqueCuts[j + 1];
            let winner: DiagnosticLineSpan | undefined;
            for (let k = 0; k < spans.length; k++) {
                const span = spans[k];
                if (span.startColumn >= end || span.endColumn <= start) continue;
                if (winner === undefined || spanWins(span, winner)) winner = span;
            }
            out.push({
                text: token.text.substring(start - tokenStart, end - tokenStart),
                color: token.color,
                fieldProp: token.fieldProp,
                linkTarget: token.linkTarget,
                underlineColor:
                    winner === undefined
                        ? undefined
                        : winner.kind === "secondary"
                          ? DIAG_SECONDARY
                          : DIAG_UNDERLINE[winner.level],
            });
        }
        tokenStart = tokenEnd;
    }
    return out;
}

function decorateLineDiagnostics(
    line: RenderableLine,
    info: LineDiagnosticInfo | undefined,
    parsed: ImportablesParseResult | null
): void {
    if (info === undefined) return;
    line.tokens = tokensWithDiagnosticSpans(line.tokens, info.spans);
    line.staticBackground = info.background;
    line.diagnostics = info.diagnostics;
    if (parsed !== null) line.diagnosticParse = parsed;
}

function endsWith(s: string, suffix: string): boolean {
    return (
        s.length >= suffix.length && s.lastIndexOf(suffix) === s.length - suffix.length
    );
}

function splitSourceLines(source: string): string[] {
    const lines = source.split("\n");
    for (let i = 0; i < lines.length; i++) {
        if (endsWith(lines[i], "\r"))
            lines[i] = lines[i].substring(0, lines[i].length - 1);
    }
    return lines;
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

function htslRenderableLines(
    path: string,
    importJsonPath: string | null | undefined
): RenderableLine[] {
    const mtime = getMtimeMs(path);
    const parsed = parsedForContext(importJsonPath);
    const parsedRef: object | null = parsed === null ? null : parsed;
    const cached = htslCache.get(path);
    if (
        cached !== undefined &&
        cached.mtime === mtime &&
        mtime !== 0 &&
        cached.parsedRef === parsedRef
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
            out.push(syntheticLine(`__parse_err_${i}`, errLines[i], COLOR_ERROR));
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

    const diagnostics = diagnosticIndexForFile(path, importJsonPath);
    const out: RenderableLine[] = [];
    const seenPaths: { [p: string]: number | undefined } = {};
    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        const lineText = indentedText(ln);
        // Main's HtslLine has no fieldSpans yet — bucket B (printActionSpans) lands separately.
        // Pass undefined so tokens carry text + color but no per-field metadata.
        const tokens: TokenSpan[] = attachFieldSpans(tokenizeHtsl(lineText), undefined);
        const pathKey = ActionPath.key(ln.actionPath);
        const seenAt = seenPaths[pathKey];
        let id: string;
        if (seenAt === undefined) {
            seenPaths[pathKey] = i;
            id = `htsl:${pathKey}`;
        } else {
            id = `htsl:${pathKey}:c${i - seenAt}`;
        }
        const lineNum = i + 1;
        const renderableLine: RenderableLine = {
            id,
            lineNum,
            depth: ln.depth,
            tokens,
            actionPath: ln.actionPath,
        };
        decorateLineDiagnostics(
            renderableLine,
            diagnostics.byLine.get(lineNum),
            diagnostics.parsed
        );
        out.push(renderableLine);
    }
    htslCache.set(path, { mtime, parsedRef, lines: out });
    return out;
}

function readPlainLines(path: string): string[] {
    const mtime = getMtimeMs(path);
    const cached = plainCache.get(path);
    if (cached !== undefined && cached.mtime === mtime && mtime !== 0) {
        return cached.lines;
    }
    let lines: string[] = [];
    try {
        const src = fileLoader.readFile(path);
        lines = splitSourceLines(src);
    } catch (e) {
        // Friendly two-liner instead of the raw exception: the exception text
        // repeats the absolute path twice and wraps into an unreadable wall.
        lines = pathExists(path)
            ? [`// Couldn't read ${shortPath(path)}`, `// ${String(e)}`]
            : [
                  `// ${shortPath(path)} no longer exists.`,
                  "// Close this tab, or recreate the file.",
              ];
    }
    plainCache.set(path, { mtime, lines });
    return lines;
}

type TextCacheEntry = {
    mtime: number;
    parsedRef: object | null;
    lines: RenderableLine[];
};
const jsonCache = new Map<string, TextCacheEntry>();

function plainTextRenderableLines(
    path: string,
    importJsonPath: string | null | undefined
): RenderableLine[] {
    const lines = readPlainLines(path);
    const diagnostics = diagnosticIndexForFile(path, importJsonPath);
    const out: RenderableLine[] = [];
    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const renderableLine: RenderableLine = {
            id: `plain:${lineNum}`,
            lineNum,
            depth: 0,
            tokens: plainTokens(lines[i], COLOR_PLAIN),
        };
        decorateLineDiagnostics(
            renderableLine,
            diagnostics.byLine.get(lineNum),
            diagnostics.parsed
        );
        out.push(renderableLine);
    }
    return out;
}

function jsonStringValue(tokenText: string): string | null {
    if (tokenText.length < 2 || tokenText.charAt(0) !== '"') return null;
    try {
        const parsed: unknown = JSON.parse(tokenText);
        return typeof parsed === "string" ? parsed : null;
    } catch (_e) {
        return null;
    }
}

function looksLikeSourceFileRef(value: string): boolean {
    const lower = value.toLowerCase();
    return (
        endsWith(lower, ".json") || endsWith(lower, ".htsl") || endsWith(lower, ".snbt")
    );
}

function addJsonFileLinks(sourcePath: string, tokens: TokenSpan[]): TokenSpan[] {
    let parent: string | null = null;
    for (let i = 0; i < tokens.length; i++) {
        const value = jsonStringValue(tokens[i].text);
        if (value === null || !looksLikeSourceFileRef(value)) continue;
        if (parent === null) parent = fileLoader.getParentPath(sourcePath);
        tokens[i].linkTarget = fileLoader.resolvePath(parent, value);
    }
    return tokens;
}

function jsonRenderableLines(
    path: string,
    importJsonPath: string | null | undefined
): RenderableLine[] {
    const mtime = getMtimeMs(path);
    const parsed = parsedForContext(importJsonPath);
    const parsedRef: object | null = parsed === null ? null : parsed;
    const cached = jsonCache.get(path);
    if (
        cached !== undefined &&
        cached.mtime === mtime &&
        mtime !== 0 &&
        cached.parsedRef === parsedRef
    ) {
        return cached.lines;
    }

    const lines = readPlainLines(path);
    const diagnostics = diagnosticIndexForFile(path, importJsonPath);
    const out: RenderableLine[] = [];
    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const renderableLine: RenderableLine = {
            id: `json:${lineNum}`,
            lineNum,
            depth: 0,
            tokens: addJsonFileLinks(
                path,
                attachFieldSpans(tokenizeJson(lines[i]), undefined)
            ),
        };
        decorateLineDiagnostics(
            renderableLine,
            diagnostics.byLine.get(lineNum),
            diagnostics.parsed
        );
        out.push(renderableLine);
    }
    jsonCache.set(path, { mtime, parsedRef, lines: out });
    return out;
}

const snbtCache = new Map<string, TextCacheEntry>();

function snbtRenderableLines(
    path: string,
    importJsonPath: string | null | undefined
): RenderableLine[] {
    const mtime = getMtimeMs(path);
    const parsed = parsedForContext(importJsonPath);
    const parsedRef: object | null = parsed === null ? null : parsed;
    const cached = snbtCache.get(path);
    if (
        cached !== undefined &&
        cached.mtime === mtime &&
        mtime !== 0 &&
        cached.parsedRef === parsedRef
    ) {
        return cached.lines;
    }

    const lines = readPlainLines(path);
    const diagnostics = diagnosticIndexForFile(path, importJsonPath);
    const out: RenderableLine[] = [];
    for (let i = 0; i < lines.length; i++) {
        const lineNum = i + 1;
        const renderableLine: RenderableLine = {
            id: `snbt:${lineNum}`,
            lineNum,
            depth: 0,
            tokens: attachFieldSpans(tokenizeSnbt(lines[i]), undefined),
        };
        decorateLineDiagnostics(
            renderableLine,
            diagnostics.byLine.get(lineNum),
            diagnostics.parsed
        );
        out.push(renderableLine);
    }
    snbtCache.set(path, { mtime, parsedRef, lines: out });
    return out;
}

type ActionLineRange = {
    actionPath: ActionPath;
    startLine: number;
    endLine: number;
    depth: number;
};

/**
 * Walks the parsed action tree, looking up each node's byte-offset span
 * and converting to a `[startLine, endLine]` range on the raw source.
 * Uses the same structured action paths as importer events and live preview rows.
 */
function collectActionLineRanges(
    actions: readonly Action[],
    spans: SpanTable,
    file: SourceFile
): ActionLineRange[] {
    const out: ActionLineRange[] = [];
    visit(actions, undefined, 0);
    return out;

    function visit(
        list: readonly Action[],
        listPath: ActionListPath | undefined,
        depth: number
    ): void {
        for (let i = 0; i < list.length; i++) {
            const a = list[i];
            const actionPath = ActionPath.at(listPath, i);
            const range = actionLineRange(file, spans, a);
            if (range === null) continue;
            out.push({
                actionPath,
                startLine: range.start,
                endLine: range.end,
                depth,
            });
            if (a.type === "CONDITIONAL") {
                visit(
                    a.ifActions,
                    ActionListPath.childOf(actionPath, "ifActions"),
                    depth + 1
                );
                visit(
                    a.elseActions,
                    ActionListPath.childOf(actionPath, "elseActions"),
                    depth + 1
                );
            } else if (a.type === "RANDOM") {
                visit(
                    a.actions,
                    ActionListPath.childOf(actionPath, "actions"),
                    depth + 1
                );
            }
        }
    }
}

/**
 * For each raw source line, pick the innermost (deepest) action whose
 * span covers it. Returns a parallel array: `pathPerLine[N-1]` is the
 * actionPath for line N, or `undefined` if no action covers that line
 * (comments, blanks, structural braces outside an action body).
 */
function pathPerLine(
    lineCount: number,
    ranges: readonly ActionLineRange[]
): Array<ActionPath | undefined> {
    const paths = new Array<ActionPath | undefined>(lineCount);
    const depths = new Array<number>(lineCount);
    for (let i = 0; i < lineCount; i++) {
        paths[i] = undefined;
        depths[i] = -1;
    }
    for (let r = 0; r < ranges.length; r++) {
        const range = ranges[r];
        for (let ln = range.startLine; ln <= range.endLine; ln++) {
            const idx = ln - 1;
            if (idx < 0 || idx >= lineCount) continue;
            if (range.depth > depths[idx]) {
                depths[idx] = range.depth;
                paths[idx] = range.actionPath;
            }
        }
    }
    return paths;
}

function depthPerLine(lineCount: number, ranges: readonly ActionLineRange[]): number[] {
    const depths = new Array<number>(lineCount);
    for (let i = 0; i < lineCount; i++) depths[i] = 0;
    for (let r = 0; r < ranges.length; r++) {
        const range = ranges[r];
        for (let ln = range.startLine; ln <= range.endLine; ln++) {
            const idx = ln - 1;
            if (idx < 0 || idx >= lineCount) continue;
            if (range.depth > depths[idx]) {
                depths[idx] = range.depth;
            }
        }
    }
    return depths;
}

const htslRawCache = new Map<
    string,
    { mtime: number; parsedRef: object | null; lines: RenderableLine[] }
>();

onParseCacheEntryChanged(() => {
    htslCache.clear();
    jsonCache.clear();
    snbtCache.clear();
    htslRawCache.clear();
});

function htslRawRenderableLines(
    path: string,
    importJsonPath: string | null | undefined
): RenderableLine[] {
    const mtime = getMtimeMs(path);
    const projectParsed = parsedForContext(importJsonPath);
    const parsedRef: object | null = projectParsed === null ? null : projectParsed;
    const cached = htslRawCache.get(path);
    if (
        cached !== undefined &&
        cached.mtime === mtime &&
        mtime !== 0 &&
        cached.parsedRef === parsedRef
    ) {
        return cached.lines;
    }

    const parsed = parseHtslFile(path);
    if (parsed.parseError !== null || parsed.file === null || parsed.spans === null) {
        // Fall back to the reconstruction renderer; it has its own error
        // path that surfaces the parse failure message.
        return htslRenderableLines(path, importJsonPath);
    }

    const ranges = collectActionLineRanges(parsed.actions, parsed.spans, parsed.file);
    const rawLines = splitSourceLines(parsed.file.src);
    const linePaths = pathPerLine(rawLines.length, ranges);
    const lineDepths = depthPerLine(rawLines.length, ranges);
    const diagnostics = diagnosticIndexForFile(path, importJsonPath);

    const seenPaths: { [p: string]: number | undefined } = {};
    const out: RenderableLine[] = [];
    for (let i = 0; i < rawLines.length; i++) {
        const text = rawLines[i];
        const tokens: TokenSpan[] = attachFieldSpans(tokenizeHtsl(text), undefined);
        const actionPath = linePaths[i];
        let id: string;
        if (actionPath !== undefined) {
            const pathKey = ActionPath.key(actionPath);
            const seenAt = seenPaths[pathKey];
            if (seenAt === undefined) {
                seenPaths[pathKey] = i;
                id = `htsl:${pathKey}`;
            } else {
                id = `htsl:${pathKey}:c${i - seenAt}`;
            }
        } else {
            id = `htsl:line${i + 1}`;
        }
        const lineNum = i + 1;
        const renderableLine: RenderableLine = {
            id,
            lineNum,
            depth: lineDepths[i],
            tokens,
            actionPath,
        };
        decorateLineDiagnostics(
            renderableLine,
            diagnostics.byLine.get(lineNum),
            diagnostics.parsed
        );
        out.push(renderableLine);
    }
    htslRawCache.set(path, { mtime, parsedRef, lines: out });
    return out;
}

export function linesForFile(
    path: string | null,
    importJsonPath?: string | null
): RenderableLine[] {
    if (path === null || path.length === 0) return [];
    const norm = path.split("\\").join("/").toLowerCase();
    if (endsWith(norm, ".htsl")) return htslRawRenderableLines(path, importJsonPath);
    if (endsWith(norm, ".json")) return jsonRenderableLines(path, importJsonPath);
    if (endsWith(norm, ".snbt")) return snbtRenderableLines(path, importJsonPath);
    return plainTextRenderableLines(path, importJsonPath);
}

export const CodeViewColors = {
    plain: COLOR_PLAIN,
    error: COLOR_ERROR,
    gutter: COLOR_GUTTER,
};
