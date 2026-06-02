/// <reference types="../../../../CTAutocomplete" />

import { normalizeHtswPath } from "../../lib/pathDisplay";

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
