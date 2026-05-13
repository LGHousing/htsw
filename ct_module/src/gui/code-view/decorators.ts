/// <reference types="../../../CTAutocomplete" />

/**
 * Built-in decorators for the code view.
 *
 * `diffDecorator` mirrors the View tab's static diff coloring (no animation
 * or focus follow). `progressDecorator` extends it with per-line freshness,
 * focus cursor tracking, and bracket/field overlays — driven by the
 * importer events captured in `codeViewState`. Both compose against the
 * same `RenderableLine` data, so a future "search highlight" or "blame"
 * decorator slots in alongside without touching the code view itself.
 */

import type { Action } from "htsw/types";
import { diffKey, getDiffEntry, type DiffState } from "../state/diff";
import {
    focusBracketForFile,
    focusFieldBoxForFile,
    focusLineIdForFile,
    underlinedFieldsForLine,
} from "../state/codeViewState";
import { lineIdForActionPath, linesForFile } from "./lineModel";
import { diffScalarFields } from "../../importer/compare";
import { getActionScalarLoreFields } from "../../importer/actionMappings";
import { parseHtslFile } from "../state/htsl-render";
import type {
    FocusBracket,
    FocusFieldBox,
    LineDecorations,
    LineDecorator,
    RenderableLine,
} from "./types";

// Right-aligned per-line labels (`add`, `edit:foo`, etc.) were dropped
// entirely — they overlapped the code text. The diff state is conveyed by
// the gutter glyph (`+`/`~`/`-`/`▶`) and the row background tint, which is
// enough.
const COLOR_PENDING_GRAY = 0xff666666 | 0;

/**
 * View tab decorator: reads diff state for the file at `path` and applies
 * the existing static coloring. No animation, no focus follow.
 */
export function diffDecorator(path: string | null): LineDecorator {
    const key = path === null ? null : diffKey(path);
    return {
        decorateLine(line: RenderableLine): LineDecorations {
            if (key === null || line.actionPath === undefined) return {};
            const entry = getDiffEntry(key);
            if (entry === undefined) return {};
            const state = entry.states.get(line.actionPath);
            if (state === undefined) {
                // No state — but if it's the current path, still color it.
                if (entry.currentPath === line.actionPath) {
                    return { state: "current", isFocused: true };
                }
                return {};
            }
            const isFocused = entry.currentPath === line.actionPath;
            const effective: DiffState = isFocused ? "current" : state;
            return {
                state: effective,
                isFocused,
            };
        },
        focusedLineId(): string | null {
            return null; // View tab does not auto-follow.
        },
    };
}

/**
 * Resolve an action by dot-path inside the source file's parsed AST.
 * Mirrors the matching helper in `htsl-render.ts:findActionByPath` but
 * lives here too so the decorator doesn't have to re-export it.
 */
function findActionByPathLocal(
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

/**
 * Compute the set of field props that differ between an observed and a
 * desired action of the same type. Returns null when the comparison
 * fails (mismatched types, missing scalar lore mapping, etc.).
 */
function changedFieldsBetween(
    observed: Action,
    desired: Action
): { [prop: string]: true } | null {
    if (observed.type !== desired.type) return null;
    let scalarProps;
    try {
        scalarProps = getActionScalarLoreFields(observed.type);
    } catch (_e) {
        return null;
    }
    const diffs = diffScalarFields(
        observed,
        desired,
        observed.type,
        scalarProps
    );
    if (diffs.length === 0) return null;
    const out: { [prop: string]: true } = {};
    for (let i = 0; i < diffs.length; i++) out[diffs[i].prop] = true;
    return out;
}

/**
 * Compute the tall `[` bracket range for the current frame: { topLineId,
 * bottomLineId, middleLineIds: Set }. Returns null when the current path
 * has no descendants currently being touched.
 */
function computeBracketRange(
    path: string,
    currentPath: string,
    descendants: string[]
): { topLineId: string; middleLineIds: { [id: string]: true }; bottomLineId: string } | null {
    if (descendants.length === 0) return null;
    // Pick the lexically-last descendant — for our path format
    // `parent.field.idx`, this lands on the deepest/last nested action.
    let deepest = descendants[0];
    for (let i = 1; i < descendants.length; i++) {
        if (descendants[i] > deepest) deepest = descendants[i];
    }
    const topLineId = lineIdForActionPath(currentPath);
    const bottomLineId = lineIdForActionPath(deepest);
    if (topLineId === bottomLineId) return null;
    const lines = linesForFile(path);
    let topIdx = -1;
    let bottomIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (topIdx < 0 && lines[i].id === topLineId) topIdx = i;
        if (lines[i].id === bottomLineId) bottomIdx = i;
    }
    if (topIdx < 0 || bottomIdx < 0 || bottomIdx <= topIdx) return null;
    const middle: { [id: string]: true } = {};
    for (let i = topIdx + 1; i < bottomIdx; i++) middle[lines[i].id] = true;
    return { topLineId, middleLineIds: middle, bottomLineId };
}

/**
 * Import tab decorator: composes `diffDecorator` with per-line animation
 * state from `codeViewState` (freshness fade, focus cursor, bracket,
 * underlines, field box).
 */
export function progressDecorator(path: string | null): LineDecorator {
    const base = diffDecorator(path);
    const key = path === null ? null : diffKey(path);
    // Pre-compute bracket info once per call so decorateLine is O(1) per line.
    let bracketRange:
        | ReturnType<typeof computeBracketRange>
        | null = null;
    if (path !== null && key !== null) {
        const entry = getDiffEntry(key);
        if (entry !== null && entry !== undefined && entry.currentPath !== null) {
            const prefix = `${entry.currentPath}.`;
            const descendants: string[] = [];
            entry.details.forEach((_v, k) => {
                if (k.indexOf(prefix) === 0) descendants.push(k);
            });
            bracketRange = computeBracketRange(path, entry.currentPath, descendants);
        }
    }
    // Lazy parse + cache of the source file's AST for field-diff lookups
    // (Phase 7 underlines). Avoid re-parsing per line.
    let cachedRootActions: readonly Action[] | null = null;
    const getRoot = (): readonly Action[] | null => {
        if (cachedRootActions !== null) return cachedRootActions;
        if (path === null) return null;
        const parsed = parseHtslFile(path);
        cachedRootActions = parsed.parseError === null ? parsed.actions : null;
        return cachedRootActions;
    };
    return {
        decorateLine(line: RenderableLine): LineDecorations {
            // Header/synthetic lines or no diff context: defer to base.
            if (path === null || key === null || line.actionPath === undefined) {
                return base.decorateLine(line);
            }
            const entry = getDiffEntry(key);
            if (entry === undefined) {
                // No diff state at all yet — leave the file looking
                // colorless until the importer plans something.
                return { foregroundColor: COLOR_PENDING_GRAY };
            }
            const isFocused = entry.currentPath === line.actionPath;
            const info = entry.details.get(line.actionPath);
            const state = entry.states.get(line.actionPath);

            // Bracket span (multi-line current op indicator).
            let bracketRole: "top" | "middle" | "bottom" | undefined;
            if (bracketRange !== null) {
                if (line.id === bracketRange.topLineId) bracketRole = "top";
                else if (line.id === bracketRange.bottomLineId) bracketRole = "bottom";
                else if (bracketRange.middleLineIds[line.id] === true)
                    bracketRole = "middle";
            }

            // Field-level focus box (blue tint over a single field token).
            let focusedFieldProp: string | undefined;
            if (
                entry.currentPath === line.actionPath &&
                entry.currentFieldProp !== null
            ) {
                focusedFieldProp = entry.currentFieldProp;
            }

            // DONE: line is finalized (either applied successfully or was
            // already a match in housing). Render with full syntax colors,
            // no diff glyph, no row background.
            const isDone = info?.completed === true || state === "match";
            if (isDone) {
                return { isFocused, bracketRole, focusedFieldProp };
            }

            // Per-field underline set for edits-in-flight.
            let underlines = underlinedFieldsForLine(path, line.id);
            if (underlines === undefined && info?.observed !== undefined && info.kind === "edit") {
                const root = getRoot();
                if (root !== null) {
                    const desired = findActionByPathLocal(root, line.actionPath);
                    if (desired !== null) {
                        const changed = changedFieldsBetween(info.observed, desired);
                        if (changed !== null) underlines = changed;
                    }
                }
            }

            // Untouched line — no diff state yet. Render gray, no syntax.
            if (state === undefined || state === "unknown") {
                return {
                    foregroundColor: COLOR_PENDING_GRAY,
                    isFocused,
                    bracketRole,
                    focusedFieldProp,
                };
            }

            // Planned line — diff glyph + tinted background, but text stays
            // gray (no syntax) because the change hasn't happened yet.
            return {
                state,
                foregroundColor: COLOR_PENDING_GRAY,
                isFocused,
                bracketRole,
                focusedFieldProp,
                underlinedFields: underlines,
            };
        },
        focusedLineId(): string | null {
            return path === null ? null : focusLineIdForFile(path);
        },
        focusBracket(): FocusBracket | null {
            return path === null ? null : focusBracketForFile(path);
        },
        focusFieldBox(): FocusFieldBox | null {
            return path === null ? null : focusFieldBoxForFile(path);
        },
    };
}
