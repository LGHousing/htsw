/// <reference types="../../CTAutocomplete" />

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
    /** The action index the importer is currently working on, if any. */
    currentIndex: number | null;
    /** Optional sub-step label rendered next to the cursor (e.g. "editing message"). */
    currentLabel: string;
    /** Frame timestamp for blink/pulse on the cursor. */
    updatedAt: number;
};

const entries: Map<DiffKey, DiffEntry> = new Map();

export function diffKey(filePath: string): DiffKey {
    return filePath.replace(/\\/g, "/");
}

export function getDiffEntry(key: DiffKey): DiffEntry | undefined {
    return entries.get(key);
}

function ensureEntry(key: DiffKey): DiffEntry {
    let e = entries.get(key);
    if (e === undefined) {
        e = { states: new Map(), currentIndex: null, currentLabel: "", updatedAt: 0 };
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
