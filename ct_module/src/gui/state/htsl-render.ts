/// <reference types="../../../CTAutocomplete" />

import { SourceMap, parseActionsResult } from "htsw";
import * as htsw from "htsw";
import type { Action } from "htsw/types";
import { FileSystemFileLoader } from "../../utils/files";
import { javaType } from "../lib/java";

export type HtslLine = {
    /** Index into the action list this line belongs to. -1 for synthetic header/blank lines. */
    actionIndex: number;
    /** Nested action path, e.g. `4.ifActions.2`; top-level lines use `4`. */
    actionPath: string;
    /** Indent level (nested actions inside CONDITIONAL/RANDOM bodies). */
    depth: number;
    /** Rendered text (no trailing newline). */
    text: string;
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
        const Paths = javaType("java.nio.file.Paths");
        const Files = javaType("java.nio.file.Files");
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

function isStructuralLine(text: string): boolean {
    return text === "}" || text.indexOf("} else") === 0 || text === "else {";
}

function actionToLines(action: Action, actionIndex: number): HtslLine[] {
    const basePath = String(actionIndex);
    let src: string;
    try {
        src = htsw.htsl.printAction(action);
    } catch (err) {
        return [{ actionIndex, actionPath: basePath, depth: 0, text: `// <print failed: ${err}>` }];
    }
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
