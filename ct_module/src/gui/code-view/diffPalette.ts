/// <reference types="../../../CTAutocomplete" />

/**
 * Shared diff-state type and palette used by both the live import preview
 * (`import-tab/livePreview.ts`, where each `PreviewLine` carries its own
 * `diffState`) and the static View-tab diff (`sourceDiff.ts`). This file
 * holds only the type + constants — the per-action state lives in those
 * modules.
 *
 *   "unknown"  — no info (gray)
 *   "match"    — current source matches the cache baseline exactly (white)
 *   "edit"     — same action type, different fields (yellow)
 *   "delete"   — cache baseline has it, current source doesn't (red)
 *   "add"      — current source has it, cache baseline doesn't (green)
 *
 * The importer's "currently touching this line" cursor is NOT a diff state —
 * it's driven by focus (see `focusedLine`) and painted with `COLOR_CURSOR`.
 */

export type DiffState =
    | "unknown"
    | "match"
    | "edit"
    | "delete"
    | "add";

/** Color of the focus cursor glyph (the `▶` on the line the importer is on). */
export const COLOR_CURSOR = 0xff79b8ff | 0;

export const COLOR_BY_STATE: { [k in DiffState]: number } = {
    unknown: 0xff666666 | 0,
    match: 0xffe5e5e5 | 0,
    edit: 0xffe3b341 | 0,
    delete: 0xfff85149 | 0,
    add: 0xff7ee787 | 0,
};

export const ROW_BG_BY_STATE: { [k in DiffState]: number | undefined } = {
    unknown: undefined,
    match: undefined,
    edit: 0x55403110 | 0,
    delete: 0x55491212 | 0,
    add: 0x55114a25 | 0,
};
