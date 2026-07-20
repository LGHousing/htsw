/**
 * Pure reducer that turns the existing progress event stream into an
 * `TaskProgress` snapshot. Import, read, and export flows all feed this
 * reducer so the UI has one progress model.
 *
 * All the snapshot-building math that used to live inside `importSession.ts`
 * (monotonic clamp, importable-scope rolling, session-scope summation) lives
 * here instead.
 */

import type { SyncEvent, ProgressScope } from "../syncEvents";
import type {
    TaskProgress,
    TaskProgressActive,
    TaskProgressEntry,
    PhaseUnits,
    ProgressPayload,
    MenuSlotFocus,
} from "./types";

type ActiveBookkeeping = {
    key: string;
    rowIndex: number;
    setupUnits: number;
    initialUnits: number;
    type: TaskProgressActive["type"];
    identity: string;
    currentTotalUnits: number;
    currentCompletedUnits: number;
    currentPhaseUnits: PhaseUnits;
    phase: TaskProgressActive["phase"];
    sync: TaskProgressActive["sync"];
    currentSlot: MenuSlotFocus | null;
};

export type ProgressReducerState = {
    progress: TaskProgress;
    active: ActiveBookkeeping | null;
    /**
     * Per-importable bookkeeping preserved across active-key switches.
     * Used by the two-pass importer: pass-1 reads/hydrates importable A,
     * then moves on to B (saving A's bookkeeping here); pass-2 later
     * re-activates A from this map without resetting its progress.
     */
    parkedRows: Partial<Record<string, ActiveBookkeeping>>;
    completedSessionUnits: number;
    totalSessionUnits: number;
};

export function initialReducerState(): ProgressReducerState {
    return {
        progress: {
            completedUnits: 0,
            totalUnits: 1,
            active: null,
            parked: {},
            rows: [],
        },
        active: null,
        parkedRows: {},
        completedSessionUnits: 0,
        totalSessionUnits: 1,
    };
}

export function reduce(
    state: ProgressReducerState,
    event: SyncEvent
): ProgressReducerState {
    switch (event.kind) {
        case "sessionStarted":
            return startSession(event.rows, event.initialTotalUnits);
        case "importableStarted":
            return startImportable(state, event);
        case "importableReactivated":
            return reactivateImportable(state, event.key, event.rowIndex, event.phase);
        case "setupStep":
            return applySetupStep(state, event.completed, event.total);
        case "progress":
            return applyProgress(state, event.scope, event.progress);
        case "menuSlotStarted":
            return applyMenuSlotStarted(state, {
                slot: event.slot,
                label: event.label,
                index: event.index,
                count: event.count,
            });
        case "importableFinished":
            return finishImportable(state, event.key, event.status, event.error);
        case "sessionFinished":
            return finishSession(state);
        // Diff-overlay / preview events don't affect the progress snapshot.
        case "readStarted":
        case "childListReadStarted":
        case "observedSnapshot":
        case "actionReadCompleted":
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
    rows: readonly TaskProgressEntry[],
    initialTotalUnits: number
): ProgressReducerState {
    const total = initialTotalUnits === 0 ? 1 : initialTotalUnits;
    return {
        progress: {
            completedUnits: 0,
            totalUnits: total,
            active: null,
            parked: {},
            rows: rows.map((r) => ({ ...r })),
        },
        active: null,
        parkedRows: {},
        completedSessionUnits: 0,
        totalSessionUnits: total,
    };
}

function startImportable(
    state: ProgressReducerState,
    event: Extract<SyncEvent, { kind: "importableStarted" }>
): ProgressReducerState {
    const parked = state.parkedRows[event.key];
    const carriedActive = parkActiveIfNeeded(state, event.key);
    if (parked !== undefined) {
        const { [event.key]: _consumed, ...rest } = carriedActive.parkedRows;
        return rebuildSnapshot({ ...carriedActive, parkedRows: rest }, parked);
    }
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
        currentSlot: null,
    };
    return rebuildSnapshot(carriedActive, active);
}

function reactivateImportable(
    state: ProgressReducerState,
    key: string,
    rowIndex: number,
    phase: ProgressPayload["phase"] | undefined
): ProgressReducerState {
    const carried = parkActiveIfNeeded(state, key);
    const parked = carried.parkedRows[key];
    if (parked === undefined) {
        // Defensive: nothing parked under this key (e.g. session restart);
        // ignore the event rather than crash.
        return carried;
    }
    const { [key]: _consumed, ...rest } = carried.parkedRows;
    const restored: ActiveBookkeeping = {
        ...parked,
        rowIndex,
        currentSlot: null,
        ...(phase === undefined ? {} : { phase }),
    };
    return rebuildSnapshot({ ...carried, parkedRows: rest }, restored);
}

/**
 * If `state.active` exists and points to a different key than the one
 * we're about to activate, move it into `parkedRows` so the importable
 * can be reactivated later with its progress intact.
 */
function parkActiveIfNeeded(
    state: ProgressReducerState,
    incomingKey: string
): ProgressReducerState {
    if (state.active === null || state.active.key === incomingKey) {
        return state;
    }
    return {
        ...state,
        parkedRows: {
            ...state.parkedRows,
            [state.active.key]: trueUpReadHydrate(state.active),
        },
    };
}

/**
 * An importable is parked once its pass-1 pre-read (read + hydrate) is done,
 * so its completed units now reflect the *actual* read/hydrate work. The
 * read/hydrate phase estimate, though, is often far larger than that — with
 * selective hydration a list's estimated child-list-read cost can be ~5× what's
 * actually read. That over-estimate sits in `currentTotalUnits` but is never
 * credited, so when the importable later finishes, `finishImportable` dumps
 * the gap to force the bar to 100% — an ETA cliff (observed ~55s).
 *
 * Pin the total to real work: `total = completed-so-far (= setup + actual
 * read/hydrate) + apply-diff cost`. Apply then credits completed exactly up
 * to that total, so finishing adds nothing and the ETA stays continuous. The
 * read/hydrate over-estimate is collapsed into the `reading` segment so the
 * phase units still sum to the (corrected) total.
 */
function trueUpReadHydrate(active: ActiveBookkeeping): ActiveBookkeeping {
    const setup = active.currentPhaseUnits.setup;
    const applying = active.currentPhaseUnits.applying;
    const preserveHydrating = active.phase === "setup" || active.phase === "reading";
    const hydrating = preserveHydrating ? active.currentPhaseUnits.hydrating : 0;
    const truedTotal = Math.max(
        active.currentCompletedUnits,
        active.currentCompletedUnits + hydrating + applying
    );
    return {
        ...active,
        currentTotalUnits: truedTotal,
        currentPhaseUnits: {
            setup,
            reading: Math.max(0, active.currentCompletedUnits - setup),
            hydrating,
            applying,
        },
    };
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

function applyMenuSlotStarted(
    state: ProgressReducerState,
    focus: MenuSlotFocus
): ProgressReducerState {
    if (state.active === null) return state;
    return rebuildSnapshot(state, { ...state.active, currentSlot: focus });
}

function applyProgress(
    state: ProgressReducerState,
    scope: ProgressScope,
    payload: ProgressPayload
): ProgressReducerState {
    if (state.active === null) return state;
    if (scope.kind !== "topLevel") {
        return applyNestedListProgress(state, scope, payload);
    }
    const setupUnits = state.active.setupUnits;
    const eventTotalUnits =
        payload.totalUnits > 0
            ? payload.totalUnits + setupUnits
            : state.active.initialUnits;
    // During read/hydrate the total only ratchets *up* (work is still being
    // discovered; anti-flicker). But applying-phase payloads carry the EXACT
    // total — the diff is known and the read/hydrate phase units now reflect
    // what was actually read, not the up-front `sumHydrationCost` over-
    // estimate. So once applying, take the payload total directly (floored at
    // completed) instead of `max`-ing against the latched read-pass estimate;
    // otherwise that stale over-estimate sticks in the total and gets dumped
    // as a phantom jump when the importable finishes. This also covers the
    // single-importable case, which never gets parked (so the park-time
    // true-up can't catch it).
    const currentTotalUnits =
        payload.phase === "applying"
            ? Math.max(state.active.currentCompletedUnits, eventTotalUnits)
            : Math.max(state.active.currentTotalUnits, eventTotalUnits);
    // Read/hydrate-phase progress payloads emit phaseUnits.applying = 0
    // because the diff isn't yet known. Preserve the prior (initial or
    // pre-read-seeded) apply estimate so the bar's apply sub-segment
    // doesn't collapse to zero width during the read/hydrate pass.
    const prevApplying = state.active.currentPhaseUnits.applying;
    const incomingApplying = payload.phaseUnits.applying;
    const applying =
        payload.preserveApplyingEstimate !== false &&
        incomingApplying === 0 &&
        prevApplying > 0
            ? prevApplying
            : incomingApplying;
    const next: ActiveBookkeeping = {
        ...state.active,
        phase: payload.phase,
        currentTotalUnits,
        currentPhaseUnits: {
            setup: setupUnits,
            reading: payload.phaseUnits.reading,
            hydrating: payload.phaseUnits.hydrating,
            applying,
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

function applyNestedListProgress(
    state: ProgressReducerState,
    scope: Exclude<ProgressScope, { kind: "topLevel" }>,
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
    status: "imported" | "skipped" | "failed",
    error?: string
): ProgressReducerState {
    if (state.active === null || state.active.key !== key) {
        return updateRowStatus(state, key, status, error);
    }
    const active = state.active;
    const completedAddend = active.currentTotalUnits;
    const totalAddend = active.currentTotalUnits - active.initialUnits;
    const rows = replaceRow(
        state.progress.rows,
        active.rowIndex,
        status,
        active.currentTotalUnits
    );
    // Include still-parked importables in the displayed totals (the
    // accumulators below stay parked-free — they're the finished/initial
    // base). Without this the display drops parked contributions the instant
    // an importable finishes, then re-adds them on the next reactivation.
    const parked = deriveParked(state.parkedRows);
    return {
        ...state,
        progress: {
            ...state.progress,
            failure:
                status === "failed"
                    ? { key, message: error ?? "Import failed" }
                    : state.progress.failure,
            active: null,
            parked: parked.snapshots,
            rows,
            completedUnits:
                state.completedSessionUnits + completedAddend + parked.completed,
            totalUnits: state.totalSessionUnits + totalAddend + parked.refinement,
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
            parked: {},
            completedUnits: state.completedSessionUnits,
            totalUnits: state.totalSessionUnits,
        },
        active: null,
        parkedRows: {},
    };
}

function updateRowStatus(
    state: ProgressReducerState,
    key: string,
    status: "imported" | "skipped" | "failed",
    error?: string
): ProgressReducerState {
    let rowIndex = -1;
    for (let i = 0; i < state.progress.rows.length; i++) {
        if (state.progress.rows[i].key === key) {
            rowIndex = i;
            break;
        }
    }
    const rows = replaceRow(state.progress.rows, rowIndex, status);
    return {
        ...state,
        progress: {
            ...state.progress,
            failure:
                status === "failed"
                    ? { key, message: error ?? "Import failed" }
                    : state.progress.failure,
            rows,
        },
    };
}

function rebuildSnapshot(
    state: ProgressReducerState,
    active: ActiveBookkeeping
): ProgressReducerState {
    const rows = replaceRow(
        state.progress.rows,
        active.rowIndex,
        "current",
        active.currentTotalUnits
    );
    const parked = deriveParked(state.parkedRows);
    const remainingSessionUnits =
        state.totalSessionUnits - state.completedSessionUnits - active.initialUnits;
    const sessionCompletedUnits =
        state.completedSessionUnits + active.currentCompletedUnits + parked.completed;
    const sessionTotalUnits =
        state.completedSessionUnits +
        active.currentTotalUnits +
        parked.refinement +
        remainingSessionUnits;
    const activeSnapshot: TaskProgressActive = {
        key: active.key,
        type: active.type,
        identity: active.identity,
        phase: active.phase,
        completedUnits: active.currentCompletedUnits,
        totalUnits: active.currentTotalUnits,
        phaseUnits: active.currentPhaseUnits,
        sync: active.sync,
        currentSlot: active.currentSlot,
    };
    return {
        ...state,
        active,
        progress: {
            completedUnits: sessionCompletedUnits,
            totalUnits: Math.max(1, sessionTotalUnits),
            active: activeSnapshot,
            parked: parked.snapshots,
            rows,
        },
    };
}

/**
 * Parked importables' contribution to the session totals: the sum of their
 * refinements (current − initial, since `totalSessionUnits` already carries
 * each one's initial estimate) and their pass-1 completed units. Folding
 * these in keeps the session total/completed stable across active-importable
 * switches instead of dropping a parked importable's estimate until it's
 * applied.
 */
type ParkedDerived = {
    refinement: number;
    completed: number;
    snapshots: { [key: string]: TaskProgressActive };
};

const parkedDerivedCache = new WeakMap<object, ParkedDerived>();

function deriveParked(
    parkedRows: Partial<Record<string, ActiveBookkeeping>>
): ParkedDerived {
    const cached = parkedDerivedCache.get(parkedRows);
    if (cached !== undefined) return cached;
    let refinement = 0;
    let completed = 0;
    const snapshots: { [key: string]: TaskProgressActive } = {};
    for (const k in parkedRows) {
        const b = parkedRows[k];
        if (b === undefined) continue;
        refinement += b.currentTotalUnits - b.initialUnits;
        completed += b.currentCompletedUnits;
        snapshots[k] = {
            key: b.key,
            type: b.type,
            identity: b.identity,
            phase: b.phase,
            completedUnits: b.currentCompletedUnits,
            totalUnits: b.currentTotalUnits,
            phaseUnits: b.currentPhaseUnits,
            sync: b.sync,
            currentSlot: b.currentSlot,
        };
    }
    const derived = { refinement, completed, snapshots };
    parkedDerivedCache.set(parkedRows, derived);
    return derived;
}

function replaceRow(
    rows: readonly TaskProgressEntry[],
    index: number,
    status: TaskProgressEntry["status"],
    totalUnits?: number
): readonly TaskProgressEntry[] {
    if (index < 0 || index >= rows.length) return rows;
    const current = rows[index];
    if (
        current.status === status &&
        (totalUnits === undefined || current.totalUnits === totalUnits)
    ) {
        return rows;
    }
    const next = rows.slice();
    next[index] = {
        ...current,
        status,
        ...(totalUnits === undefined ? {} : { totalUnits }),
    };
    return next;
}

function clamp(value: number, floor: number, ceiling: number): number {
    return Math.min(ceiling, Math.max(floor, value));
}
