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
    ImportKnowledgeState,
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
    knowledge: ImportKnowledgeState | null;
    scanCompleted: boolean;
    hydrationRequired: boolean;
    hydrationCompleted: boolean;
};

export type ProgressReducerState = {
    progress: TaskProgress;
    active: ActiveBookkeeping | null;
    /**
     * Per-importable bookkeeping preserved across active-key switches.
     * Used when the importer switches rows between scan, hydration, planning,
     * and apply without resetting earlier progress.
     */
    parkedRows: Partial<Record<string, ActiveBookkeeping>>;
    completedSessionUnits: number;
    totalSessionUnits: number;
    completedSessionApplicationUnits: number;
    totalSessionApplicationUnits: number;
    applicationTotalsPlanned: boolean;
};

export function initialReducerState(): ProgressReducerState {
    return {
        progress: {
            completedUnits: 0,
            totalUnits: 1,
            totalsLocked: false,
            active: null,
            parked: {},
            rows: [],
        },
        active: null,
        parkedRows: {},
        completedSessionUnits: 0,
        totalSessionUnits: 1,
        completedSessionApplicationUnits: 0,
        totalSessionApplicationUnits: 0,
        applicationTotalsPlanned: false,
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
        case "importableScanCompleted":
            return completeImportableScan(state, event.key, event.needsHydration);
        case "importableHydrationCompleted":
            return completeImportableHydration(state, event.key);
        case "sessionTotalsLocked":
            return lockSessionTotals(
                state,
                event.plannedRows,
                event.sessionApplicationUnits
            );
        case "sessionApplicationProgress":
            return applySessionApplicationProgress(state, event.completedUnits);
        case "applicationProgress":
            return applyApplicationProgress(state, event.completedUnits, event.sync);
        case "setupStep":
            return applySetupStep(state, event.completed, event.total);
        case "progress":
            return applyProgress(state, event.scope, event.progress);
        case "knowledgeSourceUsed":
            return applyKnowledgeSource(state, event);
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

function lockSessionTotals(
    state: ProgressReducerState,
    plannedRows:
        | readonly {
              key: string;
              applicationUnits: number;
          }[]
        | undefined,
    sessionApplicationUnits: number | undefined
): ProgressReducerState {
    if (plannedRows === undefined) {
        return {
            ...state,
            progress: { ...state.progress, totalsLocked: true },
        };
    }
    if (state.applicationTotalsPlanned) return state;

    let active = state.active;
    const parkedRows = { ...state.parkedRows };
    let rows = state.progress.rows;
    const totalSessionApplicationUnits = Math.max(0, sessionApplicationUnits ?? 0);
    let totalSessionUnits = totalSessionApplicationUnits;
    for (const planned of plannedRows) {
        if (active?.key === planned.key) {
            active = lockBookkeepingToPlan(active, planned.applicationUnits);
            totalSessionUnits += active.currentTotalUnits;
            rows = replaceRow(
                rows,
                active.rowIndex,
                rows[active.rowIndex]?.status ?? "current",
                active.currentTotalUnits
            );
            continue;
        }
        const parked = parkedRows[planned.key];
        if (parked !== undefined) {
            const locked = lockBookkeepingToPlan(parked, planned.applicationUnits);
            parkedRows[planned.key] = locked;
            totalSessionUnits += locked.currentTotalUnits;
            rows = replaceRow(
                rows,
                locked.rowIndex,
                rows[locked.rowIndex]?.status ?? "current",
                locked.currentTotalUnits
            );
            continue;
        }
        const total = planned.applicationUnits;
        totalSessionUnits += total;
        const rowIndex = rowIndexForKey(rows, planned.key);
        rows = replaceRow(rows, rowIndex, rows[rowIndex]?.status ?? "queued", total);
    }

    const next: ProgressReducerState = {
        ...state,
        active,
        parkedRows,
        totalSessionUnits,
        totalSessionApplicationUnits,
        applicationTotalsPlanned: true,
        progress: {
            ...state.progress,
            rows,
            totalUnits: visibleTotalUnits(totalSessionUnits),
            totalsLocked: true,
        },
    };
    if (active === null) return next;
    const rebuilt = rebuildSnapshot(next, active);
    return {
        ...rebuilt,
        progress: { ...rebuilt.progress, totalsLocked: true },
    };
}

function lockBookkeepingToPlan(
    bookkeeping: ActiveBookkeeping,
    applicationUnits: number
): ActiveBookkeeping {
    const observed = trueUpReadHydrate(bookkeeping);
    const applying = Math.max(0, applicationUnits);
    const total = observed.currentCompletedUnits + applying;
    return {
        ...observed,
        initialUnits: total,
        currentTotalUnits: total,
        currentPhaseUnits: {
            setup: observed.currentPhaseUnits.setup,
            reading: observed.currentPhaseUnits.reading,
            hydrating: observed.currentPhaseUnits.hydrating,
            applying,
        },
    };
}

function rowIndexForKey(rows: readonly TaskProgressEntry[], key: string): number {
    for (let i = 0; i < rows.length; i++) {
        if (rows[i].key === key) return i;
    }
    return -1;
}

function startSession(
    rows: readonly TaskProgressEntry[],
    initialTotalUnits: number
): ProgressReducerState {
    const total = visibleTotalUnits(initialTotalUnits);
    return {
        progress: {
            completedUnits: 0,
            totalUnits: total,
            totalsLocked: false,
            active: null,
            parked: {},
            rows: rows.map((r) => ({ ...r })),
        },
        active: null,
        parkedRows: {},
        completedSessionUnits: 0,
        totalSessionUnits: total,
        completedSessionApplicationUnits: 0,
        totalSessionApplicationUnits: 0,
        applicationTotalsPlanned: false,
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
        knowledge: null,
        scanCompleted: false,
        hydrationRequired: false,
        hydrationCompleted: false,
    };
    return rebuildSnapshot(carriedActive, active);
}

function completeImportableScan(
    state: ProgressReducerState,
    key: string,
    needsHydration: boolean
): ProgressReducerState {
    if (state.active?.key === key) {
        const active = {
            ...state.active,
            scanCompleted: true,
            hydrationRequired: needsHydration,
            hydrationCompleted: !needsHydration,
        };
        return rebuildSnapshot(state, active);
    }
    const parked = state.parkedRows[key];
    if (parked === undefined) return state;
    const completed = trueUpReadHydrate({
        ...parked,
        scanCompleted: true,
        hydrationRequired: needsHydration,
        hydrationCompleted: !needsHydration,
    });
    const parkedRows = { ...state.parkedRows, [key]: completed };
    return {
        ...state,
        parkedRows,
        progress: { ...state.progress, parked: deriveParked(parkedRows).snapshots },
    };
}

function reactivateImportable(
    state: ProgressReducerState,
    key: string,
    rowIndex: number,
    phase: ProgressPayload["phase"] | undefined
): ProgressReducerState {
    if (state.active !== null && state.active.key === key) {
        const active: ActiveBookkeeping = {
            ...state.active,
            rowIndex,
            currentSlot: null,
            ...(phase === undefined ? {} : { phase }),
        };
        return rebuildSnapshot(state, active);
    }
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

function completeImportableHydration(
    state: ProgressReducerState,
    key: string
): ProgressReducerState {
    if (state.active?.key === key) {
        const active = { ...state.active, hydrationCompleted: true };
        return rebuildSnapshot(state, active);
    }
    const parked = state.parkedRows[key];
    if (parked === undefined) return state;
    const completed = trueUpReadHydrate({
        ...parked,
        phase: "hydrating",
        hydrationCompleted: true,
    });
    const parkedRows = { ...state.parkedRows, [key]: completed };
    return {
        ...state,
        parkedRows,
        progress: { ...state.progress, parked: deriveParked(parkedRows).snapshots },
    };
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
 * An importable is parked once its scan and hydration are done,
 * so its completed units now reflect the *actual* read/hydrate work. The
 * read/hydrate phase estimate, though, is often far larger than that — with
 * selective hydration a list's estimated child-list-read cost can be ~5× what's
 * actually read. That over-estimate sits in `currentTotalUnits` but is never
 * credited, so when the importable later finishes, `finishImportable` dumps
 * the gap to force the bar to 100% — an ETA cliff (observed ~55s).
 *
 * Pin the total to real work: `total = completed-so-far (= setup + actual
 * read/hydrate) + apply-diff cost`. Apply then credits completed exactly up
 * to that total, so finishing adds nothing and the ETA stays continuous.
 */
function trueUpReadHydrate(active: ActiveBookkeeping): ActiveBookkeeping {
    const setup = active.currentPhaseUnits.setup;
    const applying = active.currentPhaseUnits.applying;
    if (
        !active.hydrationCompleted &&
        (active.phase === "setup" || active.phase === "reading")
    ) {
        const hydrating = active.currentPhaseUnits.hydrating;
        return {
            ...active,
            currentTotalUnits: Math.max(
                active.currentCompletedUnits,
                active.currentCompletedUnits + hydrating + applying
            ),
            currentPhaseUnits: {
                setup,
                reading: Math.max(0, active.currentCompletedUnits - setup),
                hydrating,
                applying,
            },
        };
    }
    // Hydration is done: everything completed beyond setup was real read +
    // hydrate work. Split it using the actual read units so the phase bars
    // keep their true blue/purple proportions (collapsing it all into
    // `reading` made parked rows flip from purple to blue), while the units
    // still sum to the trued-up total.
    const completedPastSetup = Math.max(0, active.currentCompletedUnits - setup);
    const reading = Math.min(active.currentPhaseUnits.reading, completedPastSetup);
    return {
        ...active,
        phase:
            active.hydrationCompleted && active.hydrationRequired
                ? "hydrating"
                : active.phase,
        currentTotalUnits: Math.max(
            active.currentCompletedUnits,
            active.currentCompletedUnits + applying
        ),
        currentPhaseUnits: {
            setup,
            reading,
            hydrating: completedPastSetup - reading,
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

function applySessionApplicationProgress(
    state: ProgressReducerState,
    completedUnits: number
): ProgressReducerState {
    if (!state.progress.totalsLocked) return state;
    const completedSessionApplicationUnits = clamp(
        completedUnits,
        state.completedSessionApplicationUnits,
        state.totalSessionApplicationUnits
    );
    const delta =
        completedSessionApplicationUnits - state.completedSessionApplicationUnits;
    if (delta === 0) return state;
    const next: ProgressReducerState = {
        ...state,
        completedSessionApplicationUnits,
        completedSessionUnits: state.completedSessionUnits + delta,
    };
    if (next.active !== null) {
        return rebuildSnapshot(next, next.active);
    }
    const parked = deriveParked(next.parkedRows);
    return {
        ...next,
        progress: {
            ...next.progress,
            parked: parked.snapshots,
            completedUnits: next.completedSessionUnits + parked.completed,
        },
    };
}

function applyApplicationProgress(
    state: ProgressReducerState,
    completedApplicationUnits: number,
    sync: TaskProgressActive["sync"]
): ProgressReducerState {
    const active = state.active;
    if (active === null || !state.applicationTotalsPlanned) return state;
    const completedBeforeApplication =
        active.currentTotalUnits - active.currentPhaseUnits.applying;
    return rebuildSnapshot(state, {
        ...active,
        phase: "applying",
        currentCompletedUnits: clamp(
            completedBeforeApplication + Math.max(0, completedApplicationUnits),
            active.currentCompletedUnits,
            active.currentTotalUnits
        ),
        sync,
    });
}

function applyKnowledgeSource(
    state: ProgressReducerState,
    event: Extract<SyncEvent, { kind: "knowledgeSourceUsed" }>
): ProgressReducerState {
    if (state.active === null) return state;
    const previous = state.active.knowledge;
    const knowledge: ImportKnowledgeState = {
        usedCache: previous?.usedCache === true || event.source === "cache",
        currentSource: event.source,
        currentReason: event.reason,
        lockStatus: event.lockStatus ?? previous?.lockStatus ?? null,
    };
    return rebuildSnapshot(state, { ...state.active, knowledge });
}

function applyProgress(
    state: ProgressReducerState,
    scope: ProgressScope,
    payload: ProgressPayload
): ProgressReducerState {
    if (state.active === null) return state;
    if (state.applicationTotalsPlanned) return state;
    if (scope.kind !== "topLevel") {
        return applyNestedListProgress(state, scope, payload);
    }
    const setupUnits = state.active.setupUnits;
    const eventTotalUnits =
        payload.totalUnits > 0
            ? payload.totalUnits + setupUnits
            : state.active.initialUnits;
    // During reading and hydration the total only ratchets *up* (work is still
    // being discovered; anti-flicker). Applying payloads carry the exact
    // total — the diff is known and the read/hydrate phase units now reflect
    // what was actually read, not the up-front `sumHydrationCost` over-
    // estimate. So once applying, take the payload total directly (floored at
    // completed) instead of `max`-ing against the latched observation estimate;
    // otherwise that stale over-estimate sticks in the total and gets dumped
    // as a phantom jump when the importable finishes. This also covers the
    // single-importable case, which never gets parked (so the park-time
    // true-up can't catch it).
    const currentTotalUnits =
        payload.phase === "applying"
            ? Math.max(state.active.currentCompletedUnits, eventTotalUnits)
            : Math.max(state.active.currentTotalUnits, eventTotalUnits);
    // Reading and hydration progress payloads emit phaseUnits.applying = 0
    // because the diff isn't yet known. Preserve the prior (initial or
    // scan-seeded) apply estimate so the bar's apply sub-segment
    // does not collapse to zero width before planning completes.
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
    const completionGap = active.currentTotalUnits - active.currentCompletedUnits;
    const completedAddend =
        status === "imported" &&
        (!state.applicationTotalsPlanned || completionGap <= 1e-6)
            ? active.currentTotalUnits
            : active.currentCompletedUnits;
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
    const parked = deriveParked(state.parkedRows);
    const completedUnits = state.completedSessionUnits + parked.completed;
    const totalUnits = state.totalSessionUnits + parked.refinement;
    return {
        ...state,
        progress: {
            ...state.progress,
            active: null,
            parked: {},
            completedUnits,
            totalUnits,
        },
        active: null,
        parkedRows: {},
        completedSessionUnits: completedUnits,
        totalSessionUnits: totalUnits,
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
        knowledge: active.knowledge,
        scanCompleted: active.scanCompleted,
        hydrationRequired: active.hydrationRequired,
    };
    return {
        ...state,
        active,
        progress: {
            completedUnits: sessionCompletedUnits,
            totalUnits: visibleTotalUnits(sessionTotalUnits),
            totalsLocked: state.progress.totalsLocked,
            active: activeSnapshot,
            parked: parked.snapshots,
            rows,
        },
    };
}

/**
 * Parked importables' contribution to the session totals: the sum of their
 * refinements (current − initial, since `totalSessionUnits` already carries
 * each one's initial estimate) and their completed observation units. Folding
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
            knowledge: b.knowledge,
            scanCompleted: b.scanCompleted,
            hydrationRequired: b.hydrationRequired,
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

function visibleTotalUnits(total: number): number {
    return total > 0 ? total : 1;
}
