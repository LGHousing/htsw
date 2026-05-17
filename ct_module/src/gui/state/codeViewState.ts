/// <reference types="../../../CTAutocomplete" />

/**
 * Per-file focus-line tracking for the Import tab's live preview. Drives
 * the Spotify-lyrics-style auto-scroll: the importer's diff sink calls
 * `setFocusLineId` when it moves to a new action, and the CodeView's
 * `applyAutoFollow` reads `focusLineIdForFile` each frame to recenter the
 * viewport.
 *
 * Kept as a separate module from `state/diff.ts` (which owns per-action
 * diff state) so the renderer can swap in alternative focus drivers
 * without touching diff state.
 */

import { normalizeHtswPath } from "../lib/pathDisplay";

type FileState = {
    focusedLineId: string | null;
};

const states: { [key: string]: FileState } = {};

function keyForFile(path: string): string {
    return normalizeHtswPath(path);
}

function ensure(path: string): FileState {
    const k = keyForFile(path);
    let s = states[k];
    if (!s) {
        s = { focusedLineId: null };
        states[k] = s;
    }
    return s;
}

export function setFocusLineId(path: string, lineId: string | null): void {
    const s = ensure(path);
    s.focusedLineId = lineId;
}

export function focusLineIdForFile(path: string): string | null {
    const k = keyForFile(path);
    const s = states[k];
    return s ? s.focusedLineId : null;
}
