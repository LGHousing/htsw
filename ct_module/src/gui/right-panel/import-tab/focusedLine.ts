/// <reference types="../../../../CTAutocomplete" />

import { normalizeHtswPath } from "../../lib/pathDisplay";
import { markGuiDirty } from "../../lib/dirty";
import { ActionTreePath } from "../../../housingSync/actionPath";
import { previewLineIdForPath } from "./livePreview";

type FileState = {
    focusPath: ActionTreePath | null;
};

const states: { [key: string]: FileState | undefined } = {};

export function focusedLineCacheSize(): number {
    return Object.keys(states).length;
}

function keyForFile(path: string): string {
    return normalizeHtswPath(path);
}

function ensure(path: string): FileState {
    const k = keyForFile(path);
    let s = states[k];
    if (s === undefined) {
        s = { focusPath: null };
        states[k] = s;
    }
    return s;
}

export function setFocusPath(path: string, actionPath: ActionTreePath | null): void {
    const s = ensure(path);
    if (
        (s.focusPath === null && actionPath === null) ||
        (s.focusPath !== null &&
            actionPath !== null &&
            ActionTreePath.equals(s.focusPath, actionPath))
    )
        return;
    s.focusPath = actionPath;
    markGuiDirty();
}

export function focusLineIdForFile(path: string): string | null {
    const k = keyForFile(path);
    const s = states[k];
    return s?.focusPath ? previewLineIdForPath(path, s.focusPath) : null;
}
