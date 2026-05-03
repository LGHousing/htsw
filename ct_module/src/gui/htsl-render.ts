/// <reference types="../../CTAutocomplete" />

import { SourceMap, parseActionsResult } from "htsw";
import * as htsw from "htsw";
import type { Action } from "htsw/types";
import { FileSystemFileLoader } from "../utils/files";

export type HtslLine = {
    /** Index into the action list this line belongs to. -1 for synthetic header/blank lines. */
    actionIndex: number;
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
export function actionToLines(action: Action, actionIndex: number): HtslLine[] {
    let src: string;
    try {
        src = htsw.htsl.printAction(action);
    } catch (err) {
        return [{ actionIndex, depth: 0, text: `// <print failed: ${err}>` }];
    }
    const out: HtslLine[] = [];
    const raw = src.split("\n");
    for (let i = 0; i < raw.length; i++) {
        const line = raw[i];
        if (line.length === 0 && i === raw.length - 1) continue; // trailing blank
        let depth = 0;
        let j = 0;
        while (j + 4 <= line.length && line.substring(j, j + 4) === "    ") {
            depth++;
            j += 4;
        }
        out.push({ actionIndex, depth, text: line.substring(j) });
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
