/// <reference types="../../../CTAutocomplete" />

import type { DiffState } from "./diff";
import type {
    ActionPath,
    DiffOpKind,
    DiffSummary,
} from "../../importer/importEvents";
import { states, keyForFile, ensure, emptyOverlay, type LiveOverlay } from "./previewLines";

export type { LiveOverlay };

export function getLiveOverlay(path: string): LiveOverlay | undefined {
    return states[keyForFile(path)]?.overlay;
}

export function setLiveState(
    path: string,
    actionPath: ActionPath,
    state: DiffState
): void {
    const o = ensure(path).overlay;
    o.states.set(actionPath, state);
    const existing = o.details.get(actionPath);
    o.details.set(actionPath, { ...(existing ?? { state }), state });
}

export function setLiveSummary(path: string, summary: DiffSummary): void {
    ensure(path).overlay.summary = summary;
}

export function setPlannedOp(
    path: string,
    actionPath: ActionPath,
    kind: DiffOpKind,
    label: string,
    detail: string
): void {
    const o = ensure(path).overlay;
    const state: DiffState =
        kind === "edit" ? "edit" : kind === "add" ? "add" : kind === "move" ? "edit" : "delete";
    const existing = o.details.get(actionPath);
    o.states.set(actionPath, state);
    o.details.set(actionPath, {
        state,
        kind,
        label: label.length > 0 ? label : existing?.label,
        detail: detail.length > 0 ? detail : existing?.detail,
    });
}

export function markLiveCompleted(path: string, actionPath: ActionPath): void {
    const o = ensure(path).overlay;
    const existing = o.details.get(actionPath);
    if (existing === undefined) return;
    o.details.set(actionPath, { ...existing, completed: true });
}

export function setLiveCurrent(
    path: string,
    actionPath: ActionPath | null,
    label: string = ""
): void {
    const o = ensure(path).overlay;
    o.currentPath = actionPath;
    o.currentLabel = label;
}

export function clearLiveOverlay(path: string): void {
    const k = keyForFile(path);
    const s = states[k];
    if (s !== undefined) s.overlay = emptyOverlay();
}
