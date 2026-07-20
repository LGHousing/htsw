/// <reference types="../../../../CTAutocomplete" />

import { normalizeHtswPath } from "../../lib/pathDisplay";
import { markGuiDirty } from "../../lib/dirty";

type FileState = {
    focusedLineId: string | null;
};

const states: { [key: string]: FileState | undefined } = {};

function keyForFile(path: string): string {
    return normalizeHtswPath(path);
}

function ensure(path: string): FileState {
    const k = keyForFile(path);
    let s = states[k];
    if (s === undefined) {
        s = { focusedLineId: null };
        states[k] = s;
    }
    return s;
}

export function setFocusLineId(path: string, lineId: string | null): void {
    const s = ensure(path);
    if (s.focusedLineId === lineId) return;
    s.focusedLineId = lineId;
    markGuiDirty();
}

export function focusLineIdForFile(path: string): string | null {
    const k = keyForFile(path);
    const s = states[k];
    return s ? s.focusedLineId : null;
}
