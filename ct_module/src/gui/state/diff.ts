/// <reference types="../../../CTAutocomplete" />

import { normalizeHtswPath } from "../lib/pathDisplay";
import type { ActionPath, DiffOpKind, DiffSummary } from "../../importer/diffSink";
import type { Action } from "htsw/types";

/**
 * Diff state model for the right-panel HTSL animation.
 *
 * The importer publishes per-action transitions while it runs:
 *   "unknown"  — knowledge says nothing or hasn't been compared yet (gray)
 *   "match"    — current source matches knowledge exactly (white)
 *   "edit"     — same action type, different fields → will be edited (yellow)
 *   "delete"   — knowledge has it, current doesn't → will be deleted (red)
 *   "add"      — current has it, knowledge doesn't → will be added (green)
 *   "current"  — the importer is touching this action right now (highlighted)
 *
 * The map is keyed by import.json path + importable identity (`type:name`)
 * so the right panel can scope rendering to "the current importable" without
 * stepping on others. Action paths identify nested source actions, e.g.
 * `4.ifActions.2`.
 */

export type DiffState =
    | "unknown"
    | "match"
    | "edit"
    | "delete"
    | "add"
    | "current";

export type DiffKey = string; // resolved file path of the .htsl being imported

export type DiffEntry = {
    /** State per source action path in the rendered list. */
    states: Map<ActionPath, DiffState>;
    details: Map<ActionPath, DiffLineInfo>;
    deletes: DiffDeleteInfo[];
    summary: DiffSummary | null;
    phaseLabel: string;
    /** The source action path the importer is currently working on, if any. */
    currentPath: ActionPath | null;
    /** Optional sub-step label rendered next to the cursor (e.g. "editing message"). */
    currentLabel: string;
    /** Frame timestamp for blink/pulse on the cursor. */
    updatedAt: number;
    /** Optional currently-edited field prop, for the field-level focus box. */
    currentFieldProp: string | null;
};

export type DiffLineInfo = {
    state: DiffState;
    kind?: DiffOpKind;
    label?: string;
    detail?: string;
    completed?: boolean;
    /**
     * For edit ops: the in-Housing action this line is being edited from.
     * Populated when the diff planner has `op.observed.action`, so the
     * code view can render a side-by-side "before / after" pair.
     */
    observed?: Action;
};

export type DiffDeleteInfo = {
    index: number;
    label: string;
    detail: string;
};

const entries: Map<DiffKey, DiffEntry> = new Map();

export function diffKey(filePath: string): DiffKey {
    // Canonicalize so the GUI's parsed-result path and the importer
    // session's parsed-result path resolve to the same key — otherwise the
    // sink writes under one key and the live-importer reads from another.
    return normalizeHtswPath(filePath);
}

export function getDiffEntry(key: DiffKey): DiffEntry | undefined {
    return entries.get(key);
}

function ensureEntry(key: DiffKey): DiffEntry {
    let e = entries.get(key);
    if (e === undefined) {
        e = {
            states: new Map(),
            details: new Map(),
            deletes: [],
            summary: null,
            phaseLabel: "",
            currentPath: null,
            currentLabel: "",
            updatedAt: 0,
            currentFieldProp: null,
        };
        entries.set(key, e);
    }
    return e;
}

export function setObservedAction(
    key: DiffKey,
    actionPath: ActionPath,
    observed: Action
): void {
    const e = ensureEntry(key);
    const existing = e.details.get(actionPath);
    e.details.set(actionPath, { ...(existing ?? { state: "unknown" }), observed });
    e.updatedAt = Date.now();
}

export function setCurrentField(key: DiffKey, prop: string | null): void {
    const e = ensureEntry(key);
    e.currentFieldProp = prop;
    e.updatedAt = Date.now();
}

export function setDiffState(
    key: DiffKey,
    actionPath: ActionPath,
    state: DiffState
): void {
    const e = ensureEntry(key);
    e.states.set(actionPath, state);
    const existing = e.details.get(actionPath);
    e.details.set(actionPath, { ...(existing ?? { state }), state });
    e.updatedAt = Date.now();
}

export function setDiffPhase(key: DiffKey, label: string): void {
    const e = ensureEntry(key);
    e.phaseLabel = label;
    e.updatedAt = Date.now();
}

export function setDiffSummary(key: DiffKey, summary: DiffSummary): void {
    const e = ensureEntry(key);
    e.summary = summary;
    e.updatedAt = Date.now();
}

export function setPlannedOp(
    key: DiffKey,
    actionPath: ActionPath,
    kind: DiffOpKind,
    label: string,
    detail: string
): void {
    const e = ensureEntry(key);
    const state: DiffState =
        kind === "edit" ? "edit" : kind === "add" ? "add" : kind === "move" ? "edit" : "delete";
    const existing = e.details.get(actionPath);
    e.states.set(actionPath, state);
    e.details.set(actionPath, {
        state,
        kind,
        label: label.length > 0 ? label : existing?.label,
        detail: detail.length > 0 ? detail : existing?.detail,
    });
    e.updatedAt = Date.now();
}

export function addDeleteOp(
    key: DiffKey,
    index: number,
    label: string,
    detail: string
): void {
    const e = ensureEntry(key);
    e.deletes.push({ index, label, detail });
    e.updatedAt = Date.now();
}

export function markCompleted(key: DiffKey, actionPath: ActionPath): void {
    const e = ensureEntry(key);
    const existing = e.details.get(actionPath);
    if (existing === undefined) return;
    e.details.set(actionPath, { ...existing, completed: true });
    e.updatedAt = Date.now();
}

export function setCurrent(
    key: DiffKey,
    actionPath: ActionPath | null,
    label: string = ""
): void {
    const e = ensureEntry(key);
    e.currentPath = actionPath;
    e.currentLabel = label;
    e.updatedAt = Date.now();
}

export function clearDiff(key: DiffKey): void {
    entries.delete(key);
}

export function clearAllDiffs(): void {
    entries.clear();
}

// GitHub-flavored diff palette: brighter foregrounds, darker tinted bgs.
// Foregrounds drive the gutter glyph + line-num + state-icon; the row bg
// is a low-saturation tint of the same hue so the eye groups added /
// edited / deleted ranges without the colour fighting the syntax tokens.
export const COLOR_BY_STATE: { [k in DiffState]: number } = {
    unknown: 0xff666666 | 0,
    match: 0xffe5e5e5 | 0,
    edit: 0xffe3b341 | 0,   // gold (GH PR review "changes requested")
    delete: 0xfff85149 | 0, // bright red
    add: 0xff7ee787 | 0,    // bright green
    current: 0xff79b8ff | 0, // soft sky blue (matches the cursor)
};

export const ROW_BG_BY_STATE: { [k in DiffState]: number | undefined } = {
    unknown: undefined,
    match: undefined,
    edit: 0x55403110 | 0,   // dark amber tint
    delete: 0x55491212 | 0, // dark red tint
    add: 0x55114a25 | 0,    // dark green tint
    current: 0x5018365d | 0, // dark blue tint (subtle, lets cursor stand out)
};
