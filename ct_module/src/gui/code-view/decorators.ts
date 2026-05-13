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
import { diffKey, getDiffEntry, ROW_BG_BY_STATE, type DiffState } from "../state/diff";
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
import type { PreviewLine } from "../state/importPreviewState";

// Right-aligned per-line labels (`add`, `edit:foo`, etc.) were dropped
// entirely — they overlapped the code text. The diff state is conveyed by
// the gutter glyph (`+`/`~`/`-`/`▶`) and the row background tint, which is
// enough.
const COLOR_PENDING_GRAY = 0xff666666 | 0;
// Ghost lines (future-edit preview) sit beneath the original body line
// and easily get mistaken for a separate real line. Render them noticeably
// dimmer than the regular pending-gray so the eye reads them as "preview"
// rather than "another action".
const COLOR_GHOST_GRAY = 0xff444444 | 0;

// Reading-phase focus tint: full-row blue strip across the action being
// read (head + nested children + close brace). Subtle so syntax tokens
// stay readable.
const COLOR_READ_FOCUS_ROW_BG = 0x5018365d | 0;
// Apply-phase focus tint: brighter blue, applied ONLY to the cursor
// column (not the row), so it doesn't fight the diff-state row tint
// (gold/red/green) of an op currently in flight.
const COLOR_APPLY_FOCUS_COLUMN_BG = 0xa067a7e8 | 0;

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
            const preview = line as PreviewLine;
            const entry = key === null ? undefined : getDiffEntry(key);

            // Phase signal: summary fires once at the start of the apply
            // phase. Reading/hydration → null. We use this to choose
            // full-row tint (read) vs cursor-column-only tint (apply).
            const isApplyPhase = entry !== undefined && entry.summary !== null;

            // Focus range = the contiguous span of lines belonging to
            // the action the importer is currently touching. Covers the
            // head line, all nested children, and the close brace —
            // because they share / nest under the same actionPath.
            const inFocusRange =
                entry !== undefined
                && entry.currentPath !== null
                && line.actionPath !== undefined
                && (line.actionPath === entry.currentPath
                    || line.actionPath.indexOf(entry.currentPath + ".") === 0);
            const isFocused =
                entry !== undefined
                && line.actionPath !== undefined
                && entry.currentPath === line.actionPath;

            // Reading: full-row blue tint across the focus range.
            // Apply: column-only blue tint, so the row's own diff-state
            // colour (gold/red/green) keeps showing through.
            const focusRowBg =
                inFocusRange && !isApplyPhase ? COLOR_READ_FOCUS_ROW_BG : undefined;
            const focusColBg =
                inFocusRange && isApplyPhase ? COLOR_APPLY_FOCUS_COLUMN_BG : undefined;

            // Bracket gutter glyphs (┌│└) for multi-line current op —
            // computed from entry.details, which is populated during
            // apply only. Reading phase has no bracket gutter glyphs
            // because the focus tint already conveys the range.
            let bracketRole: "top" | "middle" | "bottom" | undefined;
            if (bracketRange !== null) {
                if (line.id === bracketRange.topLineId) bracketRole = "top";
                else if (line.id === bracketRange.bottomLineId) bracketRole = "bottom";
                else if (bracketRange.middleLineIds[line.id] === true)
                    bracketRole = "middle";
            }

            // ── Preview-model-driven branches (live morph animation) ──

            if (preview.completed === true) {
                return {
                    isFocused,
                    bracketRole,
                    background: focusRowBg,
                    cursorColumnBackground: focusColBg,
                };
            }
            if (preview.isGhost === true) {
                // Suppress isFocused on the ghost — its body partner
                // shares the same actionPath, and putting ▶ on both
                // double-marks the same op. Cursor lives on the body.
                //
                // Set the row background DIRECTLY rather than via
                // `state: "edit"` — going through state would also
                // paint the `~` glyph in the state column, which is
                // redundant since the original body line above already
                // shows it. Gold tint here, no glyph.
                return {
                    foregroundColor: COLOR_GHOST_GRAY,
                    italic: true,
                    hideLineNum: true,
                    background: ROW_BG_BY_STATE["edit"],
                    isFocused: false,
                    bracketRole,
                    cursorColumnBackground: focusColBg,
                };
            }
            if (preview.isPlaceholder === true) {
                return {
                    foregroundColor: COLOR_PENDING_GRAY,
                    italic: true,
                    hideLineNum: true,
                    isFocused,
                    bracketRole,
                    background: focusRowBg,
                    cursorColumnBackground: focusColBg,
                };
            }
            if (preview.diffState !== undefined) {
                return {
                    state: preview.diffState,
                    foregroundColor: COLOR_PENDING_GRAY,
                    isFocused,
                    bracketRole,
                    cursorColumnBackground: focusColBg,
                };
            }

            // ── Entry-driven branches (legacy, used for non-preview lines) ──

            if (path === null || key === null || line.actionPath === undefined) {
                return base.decorateLine(line);
            }
            if (entry === undefined) {
                return { foregroundColor: COLOR_PENDING_GRAY };
            }
            const info = entry.details.get(line.actionPath);
            const state = entry.states.get(line.actionPath);

            let focusedFieldProp: string | undefined;
            if (isFocused && entry.currentFieldProp !== null) {
                focusedFieldProp = entry.currentFieldProp;
            }

            const isDone = info?.completed === true || state === "match";
            if (isDone) {
                return {
                    isFocused,
                    bracketRole,
                    focusedFieldProp,
                    background: focusRowBg,
                    cursorColumnBackground: focusColBg,
                };
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

            if (state === undefined || state === "unknown") {
                return {
                    foregroundColor: COLOR_PENDING_GRAY,
                    isFocused,
                    bracketRole,
                    focusedFieldProp,
                    background: focusRowBg,
                    cursorColumnBackground: focusColBg,
                };
            }

            return {
                state,
                foregroundColor: COLOR_PENDING_GRAY,
                isFocused,
                bracketRole,
                focusedFieldProp,
                underlinedFields: underlines,
                cursorColumnBackground: focusColBg,
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
