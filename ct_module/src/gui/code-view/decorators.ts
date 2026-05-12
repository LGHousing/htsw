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

import * as htsw from "htsw";
import type { Action } from "htsw/types";
import { diffKey, getDiffEntry, type DiffLineInfo, type DiffState } from "../state/diff";
import {
    focusBracketForFile,
    focusFieldBoxForFile,
    focusLineIdForFile,
    lifecycleAlphaForLine,
    underlinedFieldsForLine,
} from "../state/codeViewState";
import { tokenizeHtsl } from "../right-panel/syntax";
import { attachFieldSpans, lineIdForActionPath, linesForFile } from "./lineModel";
import { diffScalarFields } from "../../importer/compare";
import { getActionScalarLoreFields } from "../../importer/actionMappings";
import { parseHtslFile } from "../state/htsl-render";
import type {
    FocusBracket,
    FocusFieldBox,
    LineDecorations,
    LineDecorator,
    RenderableLine,
    TokenSpan,
} from "./types";

function detailFor(state: DiffState, info: DiffLineInfo | undefined): string | undefined {
    if (info === undefined) return undefined;
    if (state === "current" && info.label) return `current: ${info.label}`;
    if (info.completed === true) return undefined;
    if (info.kind === "edit") return info.detail ? `edit: ${info.detail}` : undefined;
    if (info.kind === "add") return "add";
    if (info.kind === "move") return info.detail ? `move: ${info.detail}` : "move";
    if (info.kind === "delete") return "delete";
    return info.detail;
}

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
            const info = entry.details.get(line.actionPath);
            return {
                state: effective,
                detail: detailFor(effective, info),
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
 * Build a synthetic RenderableLine from an in-Housing observed action.
 * Used to render the "before" row for an edit op, above the source's
 * "after" row.
 */
function observedRenderableLine(
    actionPath: string,
    observed: unknown,
    depth: number
): RenderableLine | null {
    let text: string;
    try {
        text = htsw.htsl.printAction(observed as Parameters<typeof htsw.htsl.printAction>[0]);
    } catch (_e) {
        return null;
    }
    // printAction may emit multi-line output (e.g. CONDITIONAL). We collapse
    // to the first line only for the side-by-side preview — nested bodies
    // are already visible in the desired view below.
    const splitText = text.split("\n");
    const first = splitText.length > 0 ? splitText[0] : text;
    let prefix = "";
    for (let i = 0; i < depth; i++) prefix += "  ";
    const lineText = prefix + first;
    const tokens: TokenSpan[] = attachFieldSpans(tokenizeHtsl(lineText), undefined);
    return {
        id: `observed:${actionPath}`,
        lineNum: 0,
        depth,
        tokens,
        actionPath,
        isHeader: false,
    };
}

const ROW_BG_OBSERVED = 0x40e85c5c | 0; // faint red, "before" tint
const COLOR_OBSERVED = 0xff8a92a3 | 0;  // dim gray for old text

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
            const baseDec = base.decorateLine(line);
            if (path === null || key === null) return baseDec;
            const alpha = lifecycleAlphaForLine(path, line.id);
            let underlines = underlinedFieldsForLine(path, line.id);
            // Compute underline set on-the-fly for edit ops with observed
            // actions. Cheaper than threading through a separate sink
            // event; this only runs on lines that have an active edit.
            if (underlines === undefined && line.actionPath !== undefined) {
                const entry = getDiffEntry(key);
                const info = entry?.details.get(line.actionPath);
                if (
                    info !== undefined &&
                    info.observed !== undefined &&
                    info.kind === "edit" &&
                    info.completed !== true
                ) {
                    const root = getRoot();
                    if (root !== null) {
                        const desired = findActionByPathLocal(root, line.actionPath);
                        if (desired !== null) {
                            const changed = changedFieldsBetween(info.observed, desired);
                            if (changed !== null) underlines = changed;
                        }
                    }
                }
            }

            // Side-by-side: when this line has an edit op with an observed
            // action attached, render the observed action as a gray row
            // above the desired row.
            let extras: LineDecorations["extraLinesBefore"];
            if (line.actionPath !== undefined) {
                const entry = getDiffEntry(key);
                const info = entry?.details.get(line.actionPath);
                if (info?.observed !== undefined && info.kind === "edit" && info.completed !== true) {
                    const obsLine = observedRenderableLine(
                        line.actionPath,
                        info.observed,
                        line.depth
                    );
                    if (obsLine !== null) {
                        extras = [
                            {
                                line: obsLine,
                                decorations: {
                                    foregroundColor: COLOR_OBSERVED,
                                    background: ROW_BG_OBSERVED,
                                    alpha: 0.7,
                                },
                            },
                        ];
                    }
                }
            }

            let bracketRole: "top" | "middle" | "bottom" | undefined;
            if (bracketRange !== null) {
                if (line.id === bracketRange.topLineId) bracketRole = "top";
                else if (line.id === bracketRange.bottomLineId) bracketRole = "bottom";
                else if (bracketRange.middleLineIds[line.id] === true)
                    bracketRole = "middle";
            }

            // Field-level focus: only attach to the focused line so we
            // don't tint matching fieldProp tokens elsewhere in the file.
            let focusedFieldProp: string | undefined;
            if (key !== null && line.actionPath !== undefined) {
                const entry = getDiffEntry(key);
                if (
                    entry !== undefined &&
                    entry.currentPath === line.actionPath &&
                    entry.currentFieldProp !== null
                ) {
                    focusedFieldProp = entry.currentFieldProp;
                }
            }

            return {
                state: baseDec.state,
                foregroundColor: baseDec.foregroundColor,
                background: baseDec.background,
                detail: baseDec.detail,
                isFocused: baseDec.isFocused,
                alpha,
                underlinedFields: underlines,
                extraLinesBefore: extras,
                bracketRole,
                focusedFieldProp,
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
