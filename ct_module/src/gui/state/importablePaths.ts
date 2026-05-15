/// <reference types="../../../CTAutocomplete" />

import type { ParseResult } from "htsw";
import type { Importable } from "htsw/types";
import { getParsedResult } from "./index";

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

// Single source of truth for sub-list kinds. The `SubListKind` union
// derives from this so a new kind only gets typed in one place.
export const SUB_LIST_KINDS = [
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
    parsed: ParseResult<Importable[]>,
    key: object
): string | undefined {
    try {
        const span = parsed.gcx.spans.get(key);
        return parsed.gcx.sourceMap.getFileByPos(span.start).path;
    } catch (_e) {
        return undefined;
    }
}

/**
 * Resolve `imp`'s source file path. Pass `parse` when looking up
 * importables that came from a parse other than the globally-active one
 * (multi-parse Explore + queue use-case); omit it to fall back to
 * `getParsedResult()` for legacy single-parse callers.
 */
export function importableSourcePath(
    imp: Importable,
    parse?: ParseResult<Importable[]> | null
): string | undefined {
    const parsed = parse ?? getParsedResult();
    if (parsed === null || parsed === undefined) return undefined;
    if (imp.type === "ITEM" && imp.nbt !== undefined) {
        const fromNbt = pathFromSpan(parsed, imp.nbt);
        if (fromNbt !== undefined) return fromNbt;
        // Fall through to the declaring file when the nbt span doesn't
        // resolve (e.g. inline NBT with no span recorded).
    }
    return parsed.gcx.sourceFiles.get(imp);
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
    kind: SubListKind,
    parse?: ParseResult<Importable[]> | null
): string | undefined {
    const parsed = parse ?? getParsedResult();
    if (parsed === null || parsed === undefined) return undefined;
    const list = subListOf(imp, kind);
    if (list === undefined || list.length === 0) return undefined;
    // The first action's span resolves through the SourceMap to whatever
    // file the actions live in: an htsl when the list was materialized
    // from `actionsPath: "..."`, or the declaring import.json for inline
    // JSON action lists.
    return pathFromSpan(parsed, list[0]);
}

/**
 * Every file path the given parse references — the import.json itself,
 * each importable's primary source file (htsl/snbt), and each sub-list's
 * source file. Deduplicated, returned in stable insertion order.
 */
export function allReferencedPaths(
    importJsonPath: string,
    parse: ParseResult<Importable[]> | null
): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (p: string | undefined): void => {
        if (p === undefined) return;
        if (seen.has(p)) return;
        seen.add(p);
        out.push(p);
    };
    push(importJsonPath);
    if (parse === null) return out;
    for (const imp of parse.value) {
        push(importableSourcePath(imp, parse));
        for (let i = 0; i < SUB_LIST_KINDS.length; i++) {
            push(importableSubListPath(imp, SUB_LIST_KINDS[i], parse));
        }
    }
    return out;
}
