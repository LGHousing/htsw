/// <reference types="../../../CTAutocomplete" />

/**
 * Per-line freshness / focus / bracket / field overlay state for the
 * Import tab's live preview.
 *
 * Lives alongside `state/diff.ts` (which owns per-action diff state, glyphs,
 * row backgrounds). This module owns the animated-and-transient bits — the
 * Spotify-lyrics scroll target, the gray→vibrant fade-in, the multi-line
 * bracket span, and the field-level focus box.
 *
 * All time-keyed values use `Date.now()` directly so re-render every frame
 * picks up the right interpolation. No external animation library.
 */

import { normalizeHtswPath } from "../lib/pathDisplay";
import type { FocusBracket, FocusFieldBox } from "../code-view/types";
import type { ActionPath } from "../../importer/diffSink";

// ── Animation timing constants ──────────────────────────────────────────
export const FRESH_FADE_MS = 220;        // gray → vibrant fade-in
export const QUEUED_FADE_MS = 180;       // read → queued op cross-fade
export const APPLY_PULSE_MS = 900;       // bg pulse period during applying
export const DONE_FADE_MS = 140;         // apply pulse → done settle
export const FIELD_FOCUS_MIN_MS = 120;   // hold field focus at least this long

/**
 * Per-line state machine — orthogonal to the diff-op kind (which lives in
 * `state/diff.ts:DiffEntry.states`). Together they drive the final visuals:
 * `lifecycle="applying"` + `state="edit"` means gold pulsing line, etc.
 */
export type LineLifecycle =
    | "unread"     // line exists in source; reader hasn't seen it yet (gray)
    | "read"       // reader confirmed via markMatch or readActionComplete
    | "queued"     // planOp fired; will be edited/added/deleted
    | "applying"   // beginOp fired; importer is on this line right now
    | "done"       // completeOp fired; final color
    | "error";     // read or apply error on this path

type FileState = {
    // line-id → { lifecycle, startedAt }. startedAt is Date.now() ms when
    // the lifecycle was set; we interpolate from there.
    lifecycles: Map<string, { state: LineLifecycle; startedAt: number }>;
    // Single focused line at any time.
    focusedLineId: string | null;
    focusedAt: number;
    // Per-line underline overrides (line-id → set of field props).
    underlines: Map<string, { [prop: string]: true }>;
    // Multi-line bracket span; null when no nested ops are in flight.
    bracket: FocusBracket | null;
    // Field-level focus box; null when no field is being entered.
    fieldBox: FocusFieldBox | null;
    fieldBoxAt: number;
    /**
     * `true` once the importer has started touching this file (any sink
     * event fired). Drives the "untouched line defaults to unread" branch
     * in `lifecycleAlphaForLine` — without this flag, the View tab (no
     * sink) would stay at full alpha while the Import tab fades correctly.
     */
    activelyImporting: boolean;
};

const states: { [key: string]: FileState } = {};

function keyForFile(path: string): string {
    return normalizeHtswPath(path);
}

function ensure(path: string): FileState {
    const k = keyForFile(path);
    let s = states[k];
    if (!s) {
        s = {
            lifecycles: new Map(),
            focusedLineId: null,
            focusedAt: 0,
            underlines: new Map(),
            bracket: null,
            fieldBox: null,
            fieldBoxAt: 0,
            activelyImporting: false,
        };
        states[k] = s;
    }
    return s;
}

/**
 * Mark this file as actively being imported. Called from the sink at
 * import start (`makeDiffSink` constructor). Drives the "untouched lines
 * default to unread" branch in `lifecycleAlphaForLine`.
 */
export function markActivelyImporting(path: string): void {
    const s = ensure(path);
    s.activelyImporting = true;
}

// ── Mutators (called from import-actions.ts:makeDiffSink) ───────────────

export function setLineLifecycle(
    path: string,
    lineId: string,
    state: LineLifecycle
): void {
    const s = ensure(path);
    s.lifecycles.set(lineId, { state, startedAt: Date.now() });
}

export function markAllLinesRead(path: string, lineIds: readonly string[]): void {
    const s = ensure(path);
    const now = Date.now();
    for (let i = 0; i < lineIds.length; i++) {
        s.lifecycles.set(lineIds[i], { state: "read", startedAt: now });
    }
}

export function setFocusLineId(path: string, lineId: string | null): void {
    const s = ensure(path);
    if (s.focusedLineId === lineId) return;
    s.focusedLineId = lineId;
    s.focusedAt = Date.now();
}

export function setFocusBracket(path: string, bracket: FocusBracket | null): void {
    const s = ensure(path);
    s.bracket = bracket;
}

export function setFocusFieldBox(
    path: string,
    box: FocusFieldBox | null
): void {
    const s = ensure(path);
    s.fieldBox = box;
    s.fieldBoxAt = Date.now();
}

export function setUnderlinedFieldsForLine(
    path: string,
    lineId: string,
    fields: { [prop: string]: true }
): void {
    const s = ensure(path);
    s.underlines.set(lineId, fields);
}

export function resetCodeView(path: string): void {
    const k = keyForFile(path);
    delete states[k];
}

export function resetAllCodeView(): void {
    for (const k in states) delete states[k];
}

// ── Readers (called from decorators.ts per frame) ───────────────────────

/**
 * Foreground alpha factor for a line, 0..1. Drives the gray→vibrant fade.
 *
 * - View tab (file has no lifecycle entries at all): always 1 (vibrant).
 * - Import tab during reading (file has SOME entries but this line is not
 *   yet flagged): defaults to 0.35 ("unread"). This is the gray-until-
 *   validated behaviour the user spec calls for.
 * - Line with an explicit lifecycle: lerps based on `state` + `startedAt`.
 */
export function lifecycleAlphaForLine(path: string, lineId: string): number {
    const k = keyForFile(path);
    const s = states[k];
    if (!s) return 1;
    const entry = s.lifecycles.get(lineId);
    if (!entry) {
        // File has been "primed" (sink created) but this line wasn't
        // flagged yet — treat as unread to drive the fade-in.
        return s.activelyImporting ? 0.35 : 1;
    }
    const elapsed = Date.now() - entry.startedAt;
    switch (entry.state) {
        case "unread":
            return 0.35;
        case "read":
            return Math.min(1, 0.35 + (elapsed / FRESH_FADE_MS) * 0.65);
        case "queued":
            return 0.6;
        case "applying":
            return 1;
        case "done":
            return 1;
        case "error":
            return 1;
    }
}

export function focusLineIdForFile(path: string): string | null {
    const k = keyForFile(path);
    const s = states[k];
    return s ? s.focusedLineId : null;
}

export function focusBracketForFile(path: string): FocusBracket | null {
    const k = keyForFile(path);
    const s = states[k];
    return s ? s.bracket : null;
}

export function focusFieldBoxForFile(path: string): FocusFieldBox | null {
    const k = keyForFile(path);
    const s = states[k];
    if (!s) return null;
    if (s.fieldBox === null) return null;
    // Hold the box for FIELD_FOCUS_MIN_MS even if completeField fired sooner,
    // to avoid flicker on instant anvil edits.
    const elapsed = Date.now() - s.fieldBoxAt;
    if (elapsed < FIELD_FOCUS_MIN_MS) return s.fieldBox;
    return s.fieldBox;
}

export function underlinedFieldsForLine(
    path: string,
    lineId: string
): { [prop: string]: true } | undefined {
    const k = keyForFile(path);
    const s = states[k];
    if (!s) return undefined;
    return s.underlines.get(lineId);
}

/**
 * Helpers for the diff sink integration — maps action paths into line ids
 * once the line model has produced them. The decorator hands these to the
 * sink so it can flag the right lines without knowing about the renderer.
 */
export type ActionPathToLineId = (actionPath: ActionPath) => string | null;
