/// <reference types="../../../CTAutocomplete" />

import { normalizeHtswPath } from "../lib/pathDisplay";
import type { DiffOpKind, DiffSummary } from "../../importer/diffSink";

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
 * stepping on others. Action index is the position inside the importable's
 * action list (post-merge if you're displaying both knowledge + current).
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
    /** State per action index in the rendered list. */
    states: Map<number, DiffState>;
    details: Map<number, DiffLineInfo>;
    deletes: DiffDeleteInfo[];
    summary: DiffSummary | null;
    phaseLabel: string;
    /** The action index the importer is currently working on, if any. */
    currentIndex: number | null;
    /** Optional sub-step label rendered next to the cursor (e.g. "editing message"). */
    currentLabel: string;
    /** Frame timestamp for blink/pulse on the cursor. */
    updatedAt: number;
};

export type DiffLineInfo = {
    state: DiffState;
    kind?: DiffOpKind;
    label?: string;
    detail?: string;
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
            currentIndex: null,
            currentLabel: "",
            updatedAt: 0,
        };
        entries.set(key, e);
    }
    return e;
}

export function setDiffState(
    key: DiffKey,
    actionIndex: number,
    state: DiffState
): void {
    const e = ensureEntry(key);
    e.states.set(actionIndex, state);
    const existing = e.details.get(actionIndex);
    e.details.set(actionIndex, { ...(existing ?? { state }), state });
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
    actionIndex: number,
    kind: DiffOpKind,
    label: string,
    detail: string
): void {
    const e = ensureEntry(key);
    const state: DiffState =
        kind === "edit" ? "edit" : kind === "add" ? "add" : kind === "move" ? "edit" : "delete";
    const existing = e.details.get(actionIndex);
    e.states.set(actionIndex, state);
    e.details.set(actionIndex, {
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

export function setCurrent(
    key: DiffKey,
    actionIndex: number | null,
    label: string = ""
): void {
    const e = ensureEntry(key);
    e.currentIndex = actionIndex;
    e.currentLabel = label;
    e.updatedAt = Date.now();
}

export function clearDiff(key: DiffKey): void {
    entries.delete(key);
}

export function clearAllDiffs(): void {
    entries.clear();
}

export const COLOR_BY_STATE: { [k in DiffState]: number } = {
    unknown: 0xff666666 | 0,
    match: 0xffe5e5e5 | 0,
    edit: 0xffe5bc4b | 0,
    delete: 0xffe85c5c | 0,
    add: 0xff5cb85c | 0,
    current: 0xff67a7e8 | 0,
};

export const ROW_BG_BY_STATE: { [k in DiffState]: number | undefined } = {
    unknown: undefined,
    match: undefined,
    edit: 0x40e5bc4b | 0,
    delete: 0x40e85c5c | 0,
    add: 0x405cb85c | 0,
    current: 0x4067a7e8 | 0,
};
