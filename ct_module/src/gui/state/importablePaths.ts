/// <reference types="../../../CTAutocomplete" />

import type { Importable } from "htsw/types";
import { getImportJsonPath, getParsedResult } from "./index";

/**
 * Centralized importable→path lookups.
 *
 * Three concepts the rest of the GUI keeps re-implementing:
 *
 * 1. **Source path** (`importableSourcePath`) — the file the user expects
 *    to open when they say "show me this importable". For FUNCTION/EVENT
 *    that's the resolved `.htsl`; for ITEM it's the `.snbt` (resolved via
 *    the parsed `nbt` Tag's span); for REGION/MENU/NPC it's the declaring
 *    import.json (since those types live entirely as JSON inline).
 *
 * 2. **Declaring import.json** (`importableDeclaringJson`) — the `.json`
 *    the importable was declared in. Today this is just the currently-
 *    loaded top-level path; eventually the parser may track per-importable
 *    declaring paths so sub-imports point at their own file. Callers
 *    should route through this so we have one place to update later.
 *
 * 3. **Sub-list source path** (`importableSubListPath`) — for nested
 *    action lists on REGION (`onEnterActions` / `onExitActions`) and ITEM
 *    (`leftClickActions` / `rightClickActions`). If the JSON used
 *    `{ actionsPath: "..." }` the parser materialized those actions from
 *    a separate `.htsl`; the span recorded for the resulting array
 *    resolves to that file via the SourceMap. If the actions were inline
 *    JSON the span resolves back to the declaring import.json.
 */

export type SubListKind =
    | "onEnterActions"
    | "onExitActions"
    | "leftClickActions"
    | "rightClickActions";

export function importableSourcePath(imp: Importable): string | undefined {
    const parsed = getParsedResult();
    if (parsed === null) return undefined;
    if (imp.type === "ITEM" && imp.nbt !== undefined) {
        try {
            const span = parsed.gcx.spans.get(imp.nbt);
            return parsed.gcx.sourceMap.getFileByPos(span.start).path;
        } catch (_e) {
            // Fall through to the declaring file.
        }
    }
    return parsed.gcx.sourceFiles.get(imp);
}

export function importableDeclaringJson(_imp: Importable): string {
    // Future: when the parser tracks per-importable declaring import.json,
    // resolve through that map. Today every importable shares the
    // currently-loaded top-level import.json.
    return getImportJsonPath();
}

function subListOf(imp: Importable, kind: SubListKind): readonly object[] | undefined {
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
    kind: SubListKind
): string | undefined {
    const parsed = getParsedResult();
    if (parsed === null) return undefined;
    const list = subListOf(imp, kind);
    if (list === undefined || list.length === 0) return undefined;
    // The first action's span resolves through the SourceMap to whatever
    // file the actions live in: an htsl when the list was materialized
    // from `actionsPath: "..."`, or the declaring import.json for inline
    // JSON action lists.
    try {
        const span = parsed.gcx.spans.get(list[0]);
        return parsed.gcx.sourceMap.getFileByPos(span.start).path;
    } catch (_e) {
        return undefined;
    }
}
