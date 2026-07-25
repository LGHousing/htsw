/// <reference types="../../../CTAutocomplete" />

import { SourceMap, parseActionsResult, type SourceFile, type SpanTable } from "htsw";
import * as htsw from "htsw";
import type { Action } from "htsw/types";
import { FileSystemFileLoader } from "../../utils/fileLoaders";
import { getMtimeMs } from "../lib/java";
import {
    ActionPath,
    type ChildActionListName,
    ActionListPath,
} from "../../housingSync/actionPath";

export type HtslLine = {
    /** Index into the action list this line belongs to. -1 for synthetic header/blank lines. */
    actionIndex: number;
    /** Structured path of the action that owns this rendered line. */
    actionPath: ActionPath;
    /** Indent level (child actions inside CONDITIONAL/RANDOM bodies). */
    depth: number;
    /** Rendered text (no trailing newline). */
    text: string;
};

const fileLoader = new FileSystemFileLoader();

function errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (
        error !== null &&
        typeof error === "object" &&
        "message" in error &&
        typeof error.message === "string"
    ) {
        return error.message;
    }
    return String(error);
}

export type ParsedFile = {
    mtime: number;
    actions: Action[];
    parseError: string | null;
    /** Span table for the parsed actions (and their child actions). Null on parse error. */
    spans: SpanTable | null;
    /** Source file with raw text and byte→line mapping. Null on parse error. */
    file: SourceFile | null;
};

export function actionLineRange(
    file: SourceFile,
    spans: SpanTable,
    action: Action
): { start: number; end: number } | null {
    try {
        const span = spans.get(action);
        const start = file.getPosition(span.start);
        const end = file.getPosition(span.end);
        return {
            start: start.line,
            end: end.column === 1 && end.line > start.line ? end.line - 1 : end.line,
        };
    } catch (_e) {
        return null;
    }
}

const parseCache = new Map<string, ParsedFile>();
const MAX_PARSE_CACHE_ENTRIES = 64;

export function parseHtslFile(path: string): ParsedFile {
    const mtime = getMtimeMs(path);
    const cached = parseCache.get(path);
    // mtime 0 means the stat failed (file missing or mid-creation) — never
    // serve or store a cache entry for it, or a failed first read wedges
    // the tab until an unrelated invalidation.
    if (cached !== undefined && cached.mtime === mtime && mtime !== 0) return cached;
    let actions: Action[] = [];
    let parseError: string | null = null;
    let spans: SpanTable | null = null;
    let file: SourceFile | null = null;
    try {
        const sm = new SourceMap(fileLoader);
        const r = parseActionsResult(sm, path);
        actions = r.value;
        spans = r.spans;
        // A failed read or parse comes back as a diagnostic, not a throw.
        // Only flag it when nothing parsed — a broken file used to render as
        // "(empty function)"; partial parses still render their actions.
        if (actions.length === 0) {
            for (const d of r.diagnostics) {
                if (d.level === "error" || d.level === "bug") {
                    parseError = d.message;
                    break;
                }
            }
        }
        try {
            file = sm.getFile(path);
        } catch (_e) {
            file = null;
        }
    } catch (err) {
        parseError = errorMessage(err);
    }
    const entry: ParsedFile = { mtime, actions, parseError, spans, file };
    if (!parseCache.has(path) && parseCache.size >= MAX_PARSE_CACHE_ENTRIES) {
        const oldest = parseCache.keys().next();
        if (!oldest.done) parseCache.delete(oldest.value);
    }
    parseCache.set(path, entry);
    return entry;
}

/**
 * Pretty-print one action and split into HtslLine entries tagged with the
 * given action index. Indent depth is inferred from leading spaces in the
 * printer output (4-space indent per the printer's default style).
 */
function collectChildActionPaths(action: Action, basePath: ActionPath): ActionPath[] {
    const out: ActionPath[] = [];
    function addChildren(
        actions: readonly Action[] | undefined,
        prop: ChildActionListName
    ): void {
        if (actions === undefined) return;
        const listPath = ActionListPath.childOf(basePath, prop);
        for (let i = 0; i < actions.length; i++) {
            const path = ActionPath.at(listPath, i);
            out.push(path);
            const childPaths = collectChildActionPaths(actions[i], path);
            for (let j = 0; j < childPaths.length; j++) out.push(childPaths[j]);
        }
    }
    if (action.type === "CONDITIONAL") {
        addChildren(action.ifActions, "ifActions");
        addChildren(action.elseActions, "elseActions");
    } else if (action.type === "RANDOM") {
        addChildren(action.actions, "actions");
    }
    return out;
}

function isStructuralLine(text: string): boolean {
    return text === "}" || text.indexOf("} else") === 0 || text === "else {";
}

function actionToLines(action: Action, actionIndex: number): HtslLine[] {
    const basePath = ActionPath.at(undefined, actionIndex);
    let src: string;
    try {
        src = htsw.htsl.printAction(action);
    } catch (err) {
        return [
            {
                actionIndex,
                actionPath: basePath,
                depth: 0,
                text: `// <print failed: ${String(err)}>`,
            },
        ];
    }
    const out: HtslLine[] = [];
    const raw = src.split("\n");
    const childActionPaths = collectChildActionPaths(action, basePath);
    let childActionCursor = 0;
    for (let i = 0; i < raw.length; i++) {
        const line = raw[i];
        if (line.length === 0 && i === raw.length - 1) continue; // trailing blank
        let depth = 0;
        let j = 0;
        while (j + 4 <= line.length && line.substring(j, j + 4) === "    ") {
            depth++;
            j += 4;
        }
        const text = line.substring(j);
        let actionPath = basePath;
        if (
            depth > 0 &&
            !isStructuralLine(text) &&
            childActionCursor < childActionPaths.length
        ) {
            actionPath = childActionPaths[childActionCursor];
            childActionCursor++;
        }
        out.push({ actionIndex, actionPath, depth, text });
    }
    return out;
}

export function actionsToLines(actions: readonly Action[]): HtslLine[] {
    const out: HtslLine[] = [];
    for (let i = 0; i < actions.length; i++) {
        const lines = actionToLines(actions[i], i);
        for (let j = 0; j < lines.length; j++) out.push(lines[j]);
    }
    return out;
}
