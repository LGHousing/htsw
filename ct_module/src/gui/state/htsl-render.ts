/// <reference types="../../../CTAutocomplete" />

import { SourceMap, parseActionsResult } from "htsw";
import * as htsw from "htsw";
import type { Action } from "htsw/types";
import { FileSystemFileLoader } from "../../utils/files";

/** Half-open character range tagged with the AST field it covers. */
export type HtslFieldSpan = {
    prop: string;
    start: number;
    end: number;
};

export type HtslLine = {
    /** Index into the action list this line belongs to. -1 for synthetic header/blank lines. */
    actionIndex: number;
    /** Nested action path, e.g. `4.ifActions.2`; top-level lines use `4`. */
    actionPath: string;
    /** Indent level (nested actions inside CONDITIONAL/RANDOM bodies). */
    depth: number;
    /** Rendered text (no trailing newline). */
    text: string;
    /**
     * Optional per-line field-span metadata produced by the field-aware
     * printer. Used by Phase 7 (per-token underlines) and Phase 8 (field-
     * level focus boxes). Empty/undefined for synthetic lines and when the
     * printer wasn't invoked in span mode.
     */
    fieldSpans?: HtslFieldSpan[];
};

const fileLoader = new FileSystemFileLoader();

type ParsedFile = {
    mtime: number;
    actions: Action[];
    parseError: string | null;
};

const parseCache = new Map<string, ParsedFile>();

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

export function parseHtslFile(path: string): ParsedFile {
    const mtime = getMtimeMs(path);
    const cached = parseCache.get(path);
    if (cached !== undefined && cached.mtime === mtime) return cached;
    let actions: Action[] = [];
    let parseError: string | null = null;
    try {
        const sm = new SourceMap(fileLoader);
        const r = parseActionsResult(sm, path);
        actions = r.value;
    } catch (err) {
        parseError = err && (err as any).message ? (err as any).message : String(err);
    }
    const entry: ParsedFile = { mtime, actions, parseError };
    parseCache.set(path, entry);
    return entry;
}

/**
 * Pretty-print one action and split into HtslLine entries tagged with the
 * given action index. Indent depth is inferred from leading spaces in the
 * printer output (4-space indent per the printer's default style).
 */
function childActionPaths(action: Action, basePath: string): string[] {
    const out: string[] = [];
    function addChildren(actions: readonly Action[] | undefined, prop: string): void {
        if (actions === undefined) return;
        for (let i = 0; i < actions.length; i++) {
            const path = `${basePath}.${prop}.${i}`;
            out.push(path);
            const nested = childActionPaths(actions[i], path);
            for (let j = 0; j < nested.length; j++) out.push(nested[j]);
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

/**
 * Walk an action tree by dot-path (e.g. `"4.ifActions.2"`) and return the
 * matching Action. Used to look up an Action's field spans by its path
 * during line rendering. Returns null when the path doesn't resolve.
 */
function findActionByPath(
    actions: readonly Action[],
    path: string
): Action | null {
    const parts = path.split(".");
    if (parts.length === 0) return null;
    const headIdx = Number(parts[0]);
    if (!isFinite(headIdx) || headIdx < 0 || headIdx >= actions.length) {
        return null;
    }
    let cur: Action = actions[headIdx];
    for (let i = 1; i < parts.length; i += 2) {
        const prop = parts[i];
        const idx = Number(parts[i + 1]);
        if (!isFinite(idx)) return null;
        if (cur.type === "CONDITIONAL") {
            const list = prop === "ifActions" ? cur.ifActions : prop === "elseActions" ? cur.elseActions : null;
            if (list === null || list === undefined || idx < 0 || idx >= list.length) return null;
            cur = list[idx];
        } else if (cur.type === "RANDOM") {
            if (prop !== "actions" || idx < 0 || idx >= cur.actions.length) return null;
            cur = cur.actions[idx];
        } else {
            return null;
        }
    }
    return cur;
}

function isStructuralLine(text: string): boolean {
    return text === "}" || text.indexOf("} else") === 0 || text === "else {";
}

/**
 * Lazily compute field spans for an action path by calling the field-aware
 * printer. Compared against the rendered line text — when they match, the
 * spans are valid for that line. Mismatch means the line is structural
 * (e.g. `} else {`) or a continuation, in which case no spans attach.
 */
function fieldSpansForLine(
    rootActions: readonly Action[],
    actionPath: string,
    lineText: string
): HtslFieldSpan[] | undefined {
    const target = findActionByPath(rootActions, actionPath);
    if (target === null) return undefined;
    try {
        const result = htsw.htsl.printActionSpans(target);
        // Some printers emit a multi-line head (CONDITIONAL block). Only
        // attach spans when the *first* line matches the rendered line
        // text exactly — otherwise the offsets would be wrong.
        const splitHead = result.text.split("\n");
        const firstHeadLine = splitHead.length > 0 ? splitHead[0] : "";
        if (firstHeadLine !== lineText) return undefined;
        return result.fieldSpans.length === 0 ? undefined : result.fieldSpans;
    } catch (_e) {
        return undefined;
    }
}

export function actionToLines(
    action: Action,
    actionIndex: number,
    rootActions?: readonly Action[]
): HtslLine[] {
    const basePath = String(actionIndex);
    let src: string;
    try {
        src = htsw.htsl.printAction(action);
    } catch (err) {
        return [{ actionIndex, actionPath: basePath, depth: 0, text: `// <print failed: ${err}>` }];
    }
    // When `rootActions` isn't supplied, we treat the input as the sole
    // top-level action — `findActionByPath` walks from this root.
    const actionsRoot = rootActions ?? [action];
    const out: HtslLine[] = [];
    const raw = src.split("\n");
    const nestedPaths = childActionPaths(action, basePath);
    let nestedCursor = 0;
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
        if (depth > 0 && !isStructuralLine(text) && nestedCursor < nestedPaths.length) {
            actionPath = nestedPaths[nestedCursor];
            nestedCursor++;
        }
        const fieldSpans = isStructuralLine(text)
            ? undefined
            : fieldSpansForLine(actionsRoot, actionPath, text);
        out.push({ actionIndex, actionPath, depth, text, fieldSpans });
    }
    return out;
}

export function actionsToLines(actions: readonly Action[]): HtslLine[] {
    const out: HtslLine[] = [];
    for (let i = 0; i < actions.length; i++) {
        // Pass `actions` as the root so `findActionByPath` can resolve
        // nested action paths back to AST nodes for field-span attachment.
        const lines = actionToLines(actions[i], i, actions);
        for (let j = 0; j < lines.length; j++) out.push(lines[j]);
    }
    return out;
}
