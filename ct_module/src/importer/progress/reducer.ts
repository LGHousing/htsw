/**
 * Pure reducer that turns an `ImportEvent` stream into an `ImportProgress`
 * snapshot. The importer emits events; consumers (GUI, CLI, telemetry) maintain
 * their own state by calling `reduce(state, event)` after every emit.
 *
 * All the snapshot-building math that used to live inside `importSession.ts`
 * (monotonic clamp, importable-scope rolling, session-scope summation) lives
 * here instead. The importer doesn't know `ImportProgress` exists.
 */

import type { ImportEvent, ProgressScope } from "../importEvents";
import type {
    ImportProgress,
    ImportProgressActive,
    ImportableEntry,
    PhaseUnits,
    ProgressPayload,
} from "./types";

type ActiveBookkeeping = {
    key: string;
    rowIndex: number;
    setupUnits: number;
    initialUnits: number;
    type: ImportProgressActive["type"];
    identity: string;
    currentTotalUnits: number;
    currentCompletedUnits: number;
    currentPhaseUnits: PhaseUnits;
    phase: ImportProgressActive["phase"];
    sync: ImportProgressActive["sync"];
};

export type ProgressReducerState = {
    progress: ImportProgress;
    active: ActiveBookkeeping | null;
    completedSessionUnits: number;
    totalSessionUnits: number;
};

export function initialReducerState(): ProgressReducerState {
    return {
        progress: {
            completedUnits: 0,
            totalUnits: 1,
            active: null,
            rows: [],
        },
        active: null,
        completedSessionUnits: 0,
        totalSessionUnits: 1,
    };
}

export function reduce(
    state: ProgressReducerState,
    event: ImportEvent
): ProgressReducerState {
    switch (event.kind) {
        case "sessionStarted":
            return startSession(event.rows, event.initialTotalUnits);
        case "importableStarted":
            return startImportable(state, event);
        case "setupStep":
            return applySetupStep(state, event.completed, event.total);
        case "progress":
            return applyProgress(state, event.scope, event.progress);
        case "importableFinished":
            return finishImportable(state, event.key, event.status);
        case "sessionFinished":
            return finishSession(state);
        // Diff-overlay / preview events don't affect the progress snapshot.
        case "readStarted":
        case "nestedReadStarted":
        case "observedSnapshot":
        case "diffPlanned":
        case "operationStarted":
        case "operationCompleted":
        case "listSyncCompleted":
        case "blockActionHeaderApplied":
        case "finalizeSource":
            return state;
    }
}

function startSession(
    rows: readonly ImportableEntry[],
    initialTotalUnits: number
): ProgressReducerState {
    const total = initialTotalUnits === 0 ? 1 : initialTotalUnits;
    return {
        progress: {
            completedUnits: 0,
            totalUnits: total,
            active: null,
            rows: rows.map((r) => ({ ...r })),
        },
        active: null,
        completedSessionUnits: 0,
        totalSessionUnits: total,
    };
}

function startImportable(
    state: ProgressReducerState,
    event: Extract<ImportEvent, { kind: "importableStarted" }>
): ProgressReducerState {
    const active: ActiveBookkeeping = {
        key: event.key,
        rowIndex: event.rowIndex,
        setupUnits: event.setupUnits,
        initialUnits: event.initialUnits,
        type: event.type,
        identity: event.identity,
        currentTotalUnits: event.initialUnits,
        currentCompletedUnits: 0,
        currentPhaseUnits: {
            setup: event.setupUnits,
            reading: 0,
            hydrating: 0,
            applying: Math.max(0, event.initialUnits - event.setupUnits),
        },
        phase: "setup",
        sync: null,
    };
    return rebuildSnapshot(state, active);
}

function applySetupStep(
    state: ProgressReducerState,
    completed: number,
    total: number
): ProgressReducerState {
    if (state.active === null) return state;
    const ratio = total > 0 ? Math.min(1, Math.max(0, completed / total)) : 1;
    const credited = ratio * state.active.setupUnits;
    const next: ActiveBookkeeping = {
        ...state.active,
        phase: "setup",
        currentCompletedUnits: clamp(
            credited,
            state.active.currentCompletedUnits,
            state.active.currentTotalUnits
        ),
        sync: null,
    };
    return rebuildSnapshot(state, next);
}

function applyProgress(
    state: ProgressReducerState,
    scope: ProgressScope,
    payload: ProgressPayload
): ProgressReducerState {
    if (state.active === null) return state;
    if (scope.kind === "nestedActionList") {
        return applyNestedProgress(state, scope, payload);
    }
    const setupUnits = state.active.setupUnits;
    const eventTotalUnits =
        payload.totalUnits > 0
            ? payload.totalUnits + setupUnits
            : state.active.initialUnits;
    const currentTotalUnits = Math.max(
        state.active.currentTotalUnits,
        eventTotalUnits
    );
    const next: ActiveBookkeeping = {
        ...state.active,
        phase: payload.phase,
        currentTotalUnits,
        currentPhaseUnits: {
            setup: setupUnits,
            reading: payload.phaseUnits.reading,
            hydrating: payload.phaseUnits.hydrating,
            applying: payload.phaseUnits.applying,
        },
        currentCompletedUnits: clamp(
            setupUnits + payload.completedUnits,
            state.active.currentCompletedUnits,
            currentTotalUnits
        ),
        sync: payload.sync,
    };
    return rebuildSnapshot(state, next);
}

function applyNestedProgress(
    state: ProgressReducerState,
    scope: Extract<ProgressScope, { kind: "nestedActionList" }>,
    payload: ProgressPayload
): ProgressReducerState {
    if (state.active === null) return state;
    const active = state.active;
    const completedApplyUnits = Math.min(
        active.currentPhaseUnits.applying,
        scope.baselineApplyUnits + Math.max(0, payload.completedUnits)
    );
    const completedUnits =
        active.setupUnits +
        active.currentPhaseUnits.reading +
        active.currentPhaseUnits.hydrating +
        completedApplyUnits;
    const next: ActiveBookkeeping = {
        ...active,
        phase: "applying",
        currentCompletedUnits: clamp(
            completedUnits,
            active.currentCompletedUnits,
            active.currentTotalUnits
        ),
        sync: {
            completedUnits: payload.sync.completedUnits,
            totalUnits: payload.sync.totalUnits,
            parent: scope.parentSync,
        },
    };
    return rebuildSnapshot(state, next);
}

function finishImportable(
    state: ProgressReducerState,
    key: string,
    status: "imported" | "skipped" | "failed"
): ProgressReducerState {
    if (state.active === null || state.active.key !== key) {
        return updateRowStatus(state, key, status);
    }
    const active = state.active;
    const completedAddend = active.currentTotalUnits;
    const totalAddend = active.currentTotalUnits - active.initialUnits;
    const rows = state.progress.rows.map((r, i): ImportableEntry =>
        i === active.rowIndex
            ? { ...r, status, totalUnits: active.currentTotalUnits }
            : r
    );
    return {
        ...state,
        progress: {
            ...state.progress,
            active: null,
            rows,
            completedUnits: state.completedSessionUnits + completedAddend,
            totalUnits: state.totalSessionUnits + totalAddend,
        },
        active: null,
        completedSessionUnits: state.completedSessionUnits + completedAddend,
        totalSessionUnits: state.totalSessionUnits + totalAddend,
    };
}

function finishSession(state: ProgressReducerState): ProgressReducerState {
    return {
        ...state,
        progress: {
            ...state.progress,
            active: null,
            completedUnits: state.completedSessionUnits,
            totalUnits: state.totalSessionUnits,
        },
        active: null,
    };
}

function updateRowStatus(
    state: ProgressReducerState,
    key: string,
    status: "imported" | "skipped" | "failed"
): ProgressReducerState {
    const rows = state.progress.rows.map((r): ImportableEntry =>
        r.key === key ? { ...r, status } : r
    );
    return { ...state, progress: { ...state.progress, rows } };
}

function rebuildSnapshot(
    state: ProgressReducerState,
    active: ActiveBookkeeping
): ProgressReducerState {
    const rows = state.progress.rows.map((r, i): ImportableEntry =>
        i === active.rowIndex
            ? { ...r, status: "current", totalUnits: active.currentTotalUnits }
            : r
    );
    const remainingSessionUnits =
        state.totalSessionUnits -
        state.completedSessionUnits -
        active.initialUnits;
    const sessionCompletedUnits =
        state.completedSessionUnits + active.currentCompletedUnits;
    const sessionTotalUnits =
        state.completedSessionUnits +
        active.currentTotalUnits +
        remainingSessionUnits;
    const activeSnapshot: ImportProgressActive = {
        key: active.key,
        type: active.type,
        identity: active.identity,
        phase: active.phase,
        completedUnits: active.currentCompletedUnits,
        totalUnits: active.currentTotalUnits,
        phaseUnits: active.currentPhaseUnits,
        sync: active.sync,
    };
    return {
        ...state,
        active,
        progress: {
            completedUnits: sessionCompletedUnits,
            totalUnits: Math.max(1, sessionTotalUnits),
            active: activeSnapshot,
            rows,
        },
    };
}

function clamp(value: number, floor: number, ceiling: number): number {
    return Math.min(ceiling, Math.max(floor, value));
}
