import type { GlobalCtxt } from "./context";
import type { ImportJsonFileNode, ImportJsonParseMetadata } from "./importjson";
import type { Importable } from "./types";

/**
 * Centralized importable→path lookups over a parse result.
 *
 * Two concepts consumers keep re-implementing:
 *
 * 1. **Source path** (`importableSourcePath`) — the file the user expects
 *    to open when they say "show me this importable". The parser stamps it
 *    on the importable itself (`sourcePath`): the resolved `.htsl`/`.snbt`
 *    for file-backed actions/nbt, otherwise the declaring import.json.
 *
 * 2. **Sub-list source path** (`importableSubListPath`) — for nested
 *    action lists on REGION, ITEM, COMMAND, and NPC. The parser stamps
 *    the resolved `.htsl` next to each list (`onEnterActionsPath`, …);
 *    menu slots carry `nbtPath`/`actionsPath` the same way.
 */

/** The slice of a parse result these helpers need (structurally matches
 * `ImportablesParseResult`, avoiding a cycle with the package entrypoint). */
export type ImportableParseAccess = {
    value: Importable[];
    gcx: GlobalCtxt;
    importJson: ImportJsonParseMetadata;
};

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
 * The import.json file that DECLARED `imp` — distinct from
 * `importableSourcePath`, which prefers the htsl/snbt the content lives in.
 * Falls back to the parse's entry file when the parse didn't record one.
 */
export function importableDeclaringPath(
    imp: Importable,
    parse: ImportableParseAccess
): string {
    return parse.importJson.declaringPathOf(imp) ?? parse.gcx.path;
}

export function importableSourcePath(imp: Importable): string | undefined {
    return imp.sourcePath;
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
 * A consumer may still want the row visible so the user can open the
 * empty file and edit it.
 */
export function hasSubList(imp: Importable, kind: SubListKind): boolean {
    return subListOf(imp, kind) !== undefined;
}

export function importableSubListPath(
    imp: Importable,
    kind: SubListKind
): string | undefined {
    if (subListOf(imp, kind) === undefined) return undefined;
    if (kind === "actions" && imp.type === "COMMAND") {
        return imp.actionsPath;
    }
    if (kind === "onEnterActions" && imp.type === "REGION") {
        return imp.onEnterActionsPath;
    }
    if (kind === "onExitActions" && imp.type === "REGION") {
        return imp.onExitActionsPath;
    }
    if (kind === "leftClickActions" && (imp.type === "ITEM" || imp.type === "NPC")) {
        return imp.leftClickActionsPath;
    }
    if (kind === "rightClickActions" && (imp.type === "ITEM" || imp.type === "NPC")) {
        return imp.rightClickActionsPath;
    }
    return undefined;
}

/**
 * Every source file one importable references — its primary source file
 * (htsl/snbt), each declared sub-list's source file, and each menu slot's
 * `.snbt`/`.htsl`. Undefined-filtered; order is primary-then-sub-lists and
 * may contain duplicates (an inline sub-list resolves to the same file as
 * its primary).
 */
export function importableFilePaths(imp: Importable): string[] {
    const out: string[] = [];
    const primary = importableSourcePath(imp);
    if (primary !== undefined) out.push(primary);
    for (let i = 0; i < SUB_LIST_KINDS.length; i++) {
        const sub = importableSubListPath(imp, SUB_LIST_KINDS[i]);
        if (sub !== undefined) out.push(sub);
    }
    if (imp.type === "MENU") {
        for (const slot of imp.slots) {
            if (slot.nbtPath !== undefined) out.push(slot.nbtPath);
            if (slot.actionsPath !== undefined) out.push(slot.actionsPath);
        }
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
    parse: ImportableParseAccess | null
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
        for (const p of importableFilePaths(imp)) push(p);
    }
    return out;
}
