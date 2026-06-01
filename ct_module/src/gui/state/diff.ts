/// <reference types="../../../CTAutocomplete" />

import type { DiffOpKind } from "../../importer/importEvents";

/**
 * Shared diff-state type and palette used by both the live-import
 * overlay (`importPreviewState.ts → LiveOverlay`) and the knowledge
 * overlay (`knowledgeOverlay.ts`). This file holds only the type +
 * constants — the actual per-action state maps live in those modules.
 *
 *   "unknown"  — no info (gray)
 *   "match"    — current source matches knowledge exactly (white)
 *   "edit"     — same action type, different fields (yellow)
 *   "delete"   — knowledge has it, current doesn't (red)
 *   "add"      — current has it, knowledge doesn't (green)
 *   "current"  — the importer is touching this action right now (highlighted)
 */

export type DiffState =
    | "unknown"
    | "match"
    | "edit"
    | "delete"
    | "add"
    | "current";

export type DiffLineInfo = {
    state: DiffState;
    kind?: DiffOpKind;
    label?: string;
    detail?: string;
    completed?: boolean;
};

export const COLOR_BY_STATE: { [k in DiffState]: number } = {
    unknown: 0xff666666 | 0,
    match: 0xffe5e5e5 | 0,
    edit: 0xffe3b341 | 0,
    delete: 0xfff85149 | 0,
    add: 0xff7ee787 | 0,
    current: 0xff79b8ff | 0,
};

export const ROW_BG_BY_STATE: { [k in DiffState]: number | undefined } = {
    unknown: undefined,
    match: undefined,
    edit: 0x55403110 | 0,
    delete: 0x55491212 | 0,
    add: 0x55114a25 | 0,
    current: 0x5018365d | 0,
};
