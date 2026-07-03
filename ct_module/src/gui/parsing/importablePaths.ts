/// <reference types="../../../CTAutocomplete" />

import type { ImportJsonFileNode, ImportablesParseResult } from "htsw";
import type { Importable } from "htsw/types";

/**
 * Centralized importable→path lookups.
 *
 * Two concepts the rest of the GUI keeps re-implementing:
 *
 * 1. **Source path** (`importableSourcePath`) — the file the user expects
 *    to open when they say "show me this importable". For FUNCTION/EVENT
 *    that's the resolved `.htsl`; for ITEM it's the `.snbt` (resolved via
 *    the parsed `nbt` Tag's span); for REGION/MENU/COMMAND/NPC it's the
 *    declaring import.json (since their metadata lives inline).
 *
 * 2. **Sub-list source path** (`importableSubListPath`) — for nested
 *    action lists on REGION, ITEM, COMMAND, and NPC. If the JSON used
 *    `{ actionsPath: "..." }` the parser materialized those actions from
 *    a separate `.htsl`; the span recorded for the resulting array
 *    resolves to that file via the SourceMap. If the actions were inline
 *    JSON the span resolves back to the declaring import.json.
 */

// Single source of truth for sub-list kinds. The `SubListKind` union
// derives from this so a new kind only gets typed in one place.
export const SUB_LIST_KINDS = [
    "actions",
    "onEnterActions",
    "onExitActions",
    "leftClickActions",
    "rightClickActions",
] as const;
export type SubListKind = (typeof SUB_LIST_KINDS)[number];

/**
 * Look a span-bearing object up in the parse's source map. Both the ITEM
 * `nbt` resolution and the sub-list resolution use this exact pattern;
 * extracted so neither has to inline the try/catch + double dereference.
 */
function pathFromSpan(
    parsed: ImportablesParseResult,
    key: object
): string | undefined {
    try {
        const span = parsed.gcx.spans.get(key);
        return parsed.gcx.sourceMap.getFileByPos(span.start).path;
    } catch (_e) {
        return undefined;
    }
}

function actionPathFromFieldSpan(
    parsed: ImportablesParseResult,
    imp: Importable,
    kind: SubListKind
): string | undefined {
    try {
        const span = parsed.gcx.spans.getField(imp as any, kind);
        const file = parsed.gcx.sourceMap.getFileByPos(span.start);
        const start = span.start - file.startPos;
        const end = span.end - file.startPos;
        const raw = file.src.slice(start, end);
        const value = JSON.parse(raw);
        if (typeof value !== "string") return undefined;
        return parsed.gcx.sourceMap.fileLoader.resolvePath(
            parsed.gcx.sourceMap.fileLoader.getParentPath(file.path),
            value
        );
    } catch (_e) {
        return undefined;
    }
}

/**
 * The import.json file that DECLARED `imp` — distinct from
 * `importableSourcePath`, which prefers the htsl/snbt the content lives in.
 * Falls back to the parse's entry file when the parse didn't record one.
 */
export function importableDeclaringPath(
    imp: Importable,
    parse: ImportablesParseResult
): string {
    return parse.importJson.declaringPathOf(imp) ?? parse.gcx.path;
}

export function importableSourcePath(
    imp: Importable,
    parsed: ImportablesParseResult
): string | undefined {
    if (imp.type === "ITEM" && imp.nbt !== undefined) {
        const fromNbt = pathFromSpan(parsed, imp.nbt);
        if (fromNbt !== undefined) return fromNbt;
        // Fall through to the declaring file when the nbt span doesn't
        // resolve (e.g. inline NBT with no span recorded).
    }
    return parsed.importJson.sourcePathOf(imp);
}
export function subListOf(imp: Importable, kind: SubListKind): readonly object[] | undefined {
    if (kind === "actions" && imp.type === "COMMAND") {
        return imp.actions;
    }
    if (kind === "onEnterActions" && imp.type === "REGION") {
        return imp.onEnterActions;
    }
    if (kind === "onExitActions" && imp.type === "REGION") {
        return imp.onExitActions;
    }
    if (kind === "leftClickActions" && imp.type === "ITEM") {
        return imp.leftClickActions;
    }
    if (kind === "rightClickActions" && imp.type === "ITEM") {
        return imp.rightClickActions;
    }
    if (kind === "leftClickActions" && imp.type === "NPC") {
        return imp.leftClickActions;
    }
    if (kind === "rightClickActions" && imp.type === "NPC") {
        return imp.rightClickActions;
    }
    return undefined;
}

/**
 * True when the importable declares this sub-list at all — even if the
 * list parses to an empty array (e.g. an htsl file with no actions yet).
 * We still want the chevron + sub-row visible so the user can right-click
 * through to the empty file and edit it.
 */
export function hasSubList(imp: Importable, kind: SubListKind): boolean {
    return subListOf(imp, kind) !== undefined;
}

export function importableSubListPath(
    imp: Importable,
    kind: SubListKind,
    parsed: ImportablesParseResult
): string | undefined {
    const list = subListOf(imp, kind);
    if (list === undefined) return undefined;
    const fromListSource = parsed.importJson.sourcePathOf(list as object);
    if (fromListSource !== undefined) return fromListSource;
    if (list.length === 0) return actionPathFromFieldSpan(parsed, imp, kind);
    // The first action's span resolves through the SourceMap to whatever
    // file the actions live in: an htsl when the list was materialized
    // from `actionsPath: "..."`, or the declaring import.json for inline
    // JSON action lists.
    return pathFromSpan(parsed, list[0]);
}

/**
 * Every source file one importable references — its primary source file
 * (htsl/snbt) plus each declared sub-list's source file. Undefined-filtered;
 * order is primary-then-sub-lists and may contain duplicates (an inline
 * sub-list resolves to the same file as its primary).
 */
export function importableFilePaths(
    imp: Importable,
    parse: ImportablesParseResult
): string[] {
    const out: string[] = [];
    const primary = importableSourcePath(imp, parse);
    if (primary !== undefined) out.push(primary);
    for (let i = 0; i < SUB_LIST_KINDS.length; i++) {
        const sub = importableSubListPath(imp, SUB_LIST_KINDS[i], parse);
        if (sub !== undefined) out.push(sub);
    }
    return out;
}

/**
 * Every file path the given parse references — the import.json itself,
 * each importable's primary source file (htsl/snbt), and each sub-list's
 * source file. Deduplicated, returned in stable insertion order.
 */
export function allReferencedPaths(
    importJsonPath: string,
    parse: ImportablesParseResult | null
): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (p: string): void => {
        if (seen.has(p)) return;
        seen.add(p);
        out.push(p);
    };
    push(importJsonPath);
    if (parse === null) return out;
    // Included import.jsons too — an importable-less include would otherwise
    // be missing from the fingerprint, so edits to it never bust the cache.
    const pushTree = (node: ImportJsonFileNode): void => {
        push(node.path);
        for (let i = 0; i < node.includes.length; i++) pushTree(node.includes[i]);
    };
    if (parse.importJson.fileTree !== null) pushTree(parse.importJson.fileTree);
    for (const imp of parse.value) {
        for (const p of importableFilePaths(imp, parse)) push(p);
    }
    return out;
}
