/// <reference types="../../../../CTAutocomplete" />

/**
 * Shared task progress state. Owns the `TaskProgress` object used by import,
 * read, export, and diff flows, plus derived queue-row render state and helpers
 * for building fresh progress shapes.
 *
 * Read by: the right-panel progress panel, queue rows, and code-view focus
 * tracking. Written by task controllers through the functions in this module.
 */

import type { Importable } from "htsw/types";

import type {
    TaskProgress,
    TaskProgressEntry,
} from "../../../housingSync/progress/types";
import { queueRowKey } from "../../../housingSync/progress/queueRowKey";
import {
    createEtaCalculator,
    currentMsPerUnit,
    type EtaCalculator,
} from "../../../housingSync/progress/eta";
import { setProgressTraceSampler } from "../../../housingSync/trace/progressTrace";
import { resetSessionTiming } from "../../../housingSync/progress/timing";
import { importableIdentity } from "../../../importables/identity";
import {
    isQueueSessionItem,
    queueItemKey,
    queueItemProgressPath,
    type QueueItem,
} from "./queue";
import { canonicalPath } from "../../parsing/parses";
import {
    onTaskRunningChanged,
    rememberLiveTaskPath,
    setLiveTaskPathProvider,
} from "../selection";
import { markGuiDirty } from "../../lib/dirty";
import { getActiveTaskElapsedMs } from "../../../tasks/activeTask";

// Feed the progress trace's periodic sampler the *displayed* ETA values, so
// `/htsw eta trace` captures what the user sees between events (the smoothing
// behavior in the gaps), not just the per-event candidate.
setProgressTraceSampler(() => {
    if (taskProgress === null) return null;
    return {
        etaSec: getTaskEtaSeconds(),
        phaseEtaSec: getCurrentPhaseEtaSeconds(),
        msPerUnit: currentMsPerUnit(),
        remaining: Math.max(0, taskProgress.totalUnits - taskProgress.completedUnits),
        completed: taskProgress.completedUnits,
        total: taskProgress.totalUnits,
    };
});

let taskProgress: TaskProgress | null = null;
let taskProgressRows = new Map<string, TaskProgressEntry>();
/**
 * The last final task progress, kept after `taskProgress` is cleared
 * so the queue can still render done/skipped/failed states for a short
 * window after the task completes (the queue items stay visible briefly
 * for confirmation before being cleared).
 */
let lastFinishedTaskProgress: TaskProgress | null = null;
let lastFinishedTaskRows = new Map<string, TaskProgressEntry>();
let finishedTaskFailure: string | null = null;
type FinishedTaskSummary = {
    title: string;
    message: string;
};
let finishedTaskSummary: FinishedTaskSummary | null = null;
/** Fresh per task session — cleared when `taskProgress` returns to null. */
let etaCalc: EtaCalculator | null = null;
/**
 * Path-shaped identity for the in-flight task tab. Imports use the current
 * source file; exports and reads use an in-memory `.htsl` preview identity.
 * Cleared when the task finishes.
 */
let activeTaskPath: string | null = null;

setLiveTaskPathProvider(() => activeTaskPath);

export function getTaskProgress(): TaskProgress | null {
    return taskProgress;
}

export function parkedTaskFor(
    progress: TaskProgress,
    key: string
): TaskProgress["parked"][string] | undefined {
    if (!Object.prototype.hasOwnProperty.call(progress.parked, key)) return undefined;
    return progress.parked[key];
}

/**
 * The user-facing verb for the active progress session. Import, export, read,
 * and diff share one progress strip and queue summary.
 */
type SessionVerb = "import" | "export" | "read" | "diff";
let sessionVerb: SessionVerb = "import";
export function getSessionVerb(): SessionVerb {
    return sessionVerb;
}
function setSessionVerb(v: SessionVerb): void {
    if (sessionVerb === v) return;
    sessionVerb = v;
    markGuiDirty();
}

/**
 * True when the session's per-item unit sizes are pure fallbacks (no cached
 * or source content to size from), so the displayed ETA is a rough guess.
 * Set by the export sink at session start; reset when a new session begins.
 */
let etaRough = false;
export function isEtaRough(): boolean {
    return etaRough;
}
function setEtaRough(v: boolean): void {
    if (etaRough === v) return;
    etaRough = v;
    markGuiDirty();
}

let etaEstimating = false;
export function isEtaEstimating(): boolean {
    return etaEstimating;
}
export function setEtaEstimating(v: boolean): void {
    if (etaEstimating === v) return;
    etaEstimating = v;
    markGuiDirty();
}

/**
 * Whether the in-flight import session is allowed to trust the cache (the
 * per-house Trust toggle, sampled at session start). Null while idle or for
 * non-import sessions. The progress panel's Source line uses this to say
 * "trust off" outright instead of implying a cache/lock problem when the
 * session was never going to use the cache.
 */
let sessionTrustMode: boolean | null = null;
export function getSessionTrustMode(): boolean | null {
    return sessionTrustMode;
}
function setSessionTrustMode(v: boolean | null): void {
    if (sessionTrustMode === v) return;
    sessionTrustMode = v;
    markGuiDirty();
}

/** Display name of the importable currently being processed, or null when idle. */
export function getActiveTaskLabel(): string | null {
    if (taskProgress === null || taskProgress.active === null) return null;
    return taskProgress.active.identity;
}

export function getTaskProgressFraction(): number {
    const p = taskProgress;
    if (p === null || p.totalUnits <= 0) return 0;
    return Math.min(1, Math.max(0, p.completedUnits / p.totalUnits));
}

export function getTaskEtaSeconds(): number | null {
    return etaCalc === null ? null : etaCalc.getTotal(taskProgress);
}

export function getCurrentPhaseEtaSeconds(): number | null {
    return etaCalc === null ? null : etaCalc.getPhase(taskProgress);
}

export function getTaskEtcMs(): number | null {
    const secs = getTaskEtaSeconds();
    if (secs === null) return null;
    return Date.now() + Math.max(0, Math.round(secs * 1000));
}

export function getTaskElapsedMs(): number | null {
    return getActiveTaskElapsedMs();
}

export function getActiveTaskPath(): string | null {
    return activeTaskPath;
}
export function setActiveTaskPath(p: string | null): void {
    if (activeTaskPath === p) return;
    activeTaskPath = p;
    if (p !== null) rememberLiveTaskPath(p);
    markGuiDirty();
}

export function createTaskRows(
    importables: readonly Importable[],
    sourcePath: string
): TaskProgressEntry[] {
    const rows: TaskProgressEntry[] = [];
    for (let i = 0; i < importables.length; i++) {
        const importable = importables[i];
        const identity = importableIdentity(importable);
        rows.push({
            key: queueRowKey(importable.type, identity, sourcePath),
            status: "queued",
            totalUnits: 1,
        });
    }
    return rows;
}

export function createTaskProgress(init: Partial<TaskProgress>): TaskProgress {
    return normalizeTaskProgress({
        completedUnits: init.completedUnits ?? 0,
        totalUnits: init.totalUnits ?? 1,
        totalsLocked: init.totalsLocked ?? false,
        active: init.active ?? null,
        parked: init.parked ?? {},
        rows: init.rows ?? [],
    });
}

function normalizeTaskProgress(p: TaskProgress): TaskProgress {
    const completedUnits = Math.max(0, p.completedUnits);
    const totalUnits = Math.max(1, p.totalUnits, completedUnits);
    return {
        ...p,
        completedUnits,
        totalUnits,
    };
}

function updateTaskProgress(
    p: TaskProgress | null,
    finishedTaskNeedsAttention: boolean
): void {
    const wasNull = taskProgress === null;
    const previousRows = taskProgress?.rows ?? null;
    if (p !== null && taskProgress === null) {
        etaCalc = createEtaCalculator();
        resetSessionTiming();
        lastFinishedTaskProgress = null;
        finishedTaskFailure = null;
        finishedTaskSummary = null;
        // Session defaults — reset at START, not at clear: the queue keeps
        // rendering `lastFinishedTaskProgress` for a confirmation window after a
        // run, and resetting the verb on clear would mislabel those rows.
        sessionVerb = "import";
        etaRough = false;
        etaEstimating = false;
        sessionTrustMode = null;
    } else if (p === null) {
        lastFinishedTaskProgress = taskProgress;
        lastFinishedTaskRows = taskProgressRows;
        taskProgressRows = new Map<string, TaskProgressEntry>();
        etaCalc = null;
    }
    taskProgress = p === null ? null : normalizeTaskProgress(p);
    if (taskProgress !== null && taskProgress.rows !== previousRows) {
        taskProgressRows = new Map<string, TaskProgressEntry>();
        for (let i = 0; i < taskProgress.rows.length; i++) {
            const row = taskProgress.rows[i];
            taskProgressRows.set(row.key, row);
        }
    }
    onTaskRunningChanged(!wasNull, p !== null, finishedTaskNeedsAttention);
    markGuiDirty();
}

type TaskProgressStart = {
    progress: TaskProgress;
    verb: SessionVerb;
    path: string | null;
    etaRough?: boolean;
    trustMode?: boolean | null;
};

export function startTaskProgress(options: TaskProgressStart): void {
    setTaskProgress(options.progress);
    setSessionVerb(options.verb);
    setEtaRough(options.etaRough === true);
    setSessionTrustMode(options.trustMode ?? null);
    setActiveTaskPath(options.path);
}

export function setTaskProgress(p: TaskProgress): void {
    updateTaskProgress(p, false);
}

export function finishTaskProgress(
    failure: string | null,
    summary: FinishedTaskSummary | null = null
): void {
    setActiveTaskPath(null);
    finishedTaskFailure = failure;
    finishedTaskSummary = summary;
    updateTaskProgress(null, failure !== null);
}

export function clearTaskProgress(): void {
    setActiveTaskPath(null);
    finishedTaskFailure = null;
    finishedTaskSummary = null;
    updateTaskProgress(null, false);
}

export function getFinishedTaskFailure(): string | null {
    return finishedTaskFailure;
}

export function getFinishedTaskSummary(): FinishedTaskSummary | null {
    return finishedTaskSummary;
}

export function clearLastFinishedProgress(): void {
    if (
        lastFinishedTaskProgress === null &&
        finishedTaskFailure === null &&
        finishedTaskSummary === null
    ) {
        return;
    }
    lastFinishedTaskProgress = null;
    lastFinishedTaskRows = new Map<string, TaskProgressEntry>();
    finishedTaskFailure = null;
    finishedTaskSummary = null;
    markGuiDirty();
}

/**
 * Render-state for a queue row's mini progress bar. "queued" → empty bar;
 * "done" → full green; "failed" → full red; "current" → phase-segmented
 * showing how far through each phase we are within this importable.
 */
type QueuePhase = "reading" | "hydrating" | "applying";

export type QueueItemRunState =
    | { kind: "queued" }
    | { kind: "done" }
    | { kind: "skipped" }
    | { kind: "failed" }
    | {
          kind: "current";
          phase: QueuePhase;
          phaseUnits: PhaseUnits;
          completedUnits: number;
      }
    | {
          kind: "parked";
          phase: QueuePhase;
          phaseUnits: PhaseUnits;
          completedUnits: number;
      };

export function getQueueItemRunState(item: QueueItem): QueueItemRunState {
    const useLastFinished =
        taskProgress === null && isQueueSessionItem(queueItemKey(item));
    const progress = taskProgress ?? (useLastFinished ? lastFinishedTaskProgress : null);
    if (progress === null) {
        return { kind: "queued" };
    }
    if (item.kind !== "importable") {
        // importJson rows aren't tracked individually; treat as queued.
        return { kind: "queued" };
    }
    const progressPath = queueItemProgressPath(item);
    if (progressPath === null) return { kind: "queued" };
    const key = queueRowKey(item.type, item.identity, progressPath);
    const row = (useLastFinished ? lastFinishedTaskRows : taskProgressRows).get(key);
    if (row === undefined) return { kind: "queued" };
    if (row.status === "imported") return { kind: "done" };
    if (row.status === "skipped") return { kind: "skipped" };
    if (row.status === "failed") {
        // The session halts on first failure, so everything after this
        // stays queued. We render the failed row with the error color
        // (distinct from the green "done" fill) so the user can see at a
        // glance which importable aborted the run.
        return { kind: "failed" };
    }
    if (row.status === "queued") return { kind: "queued" };
    const current = progress.active;
    if (current === null || current.key !== key) {
        const parked = parkedTaskFor(progress, key);
        if (parked !== undefined) {
            const snap = runStateFromActive(parked);
            return {
                kind: "parked",
                phase: snap.phase,
                phaseUnits: snap.phaseUnits,
                completedUnits: snap.completedUnits,
            };
        }
        return {
            kind: "parked",
            phase: "reading",
            phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
            completedUnits: 0,
        };
    }
    return runStateFromActive(current);
}

export type PhaseUnits = {
    setup: number;
    reading: number;
    hydrating: number;
    applying: number;
};

/**
 * The ONE mapping from (phase unit sizes, units completed so far) to
 * per-phase completion fractions. Both the queue-row minibars and the footer
 * progress bar render from this; a second copy of this math lets the two
 * displays of the same import disagree.
 */
export function phaseFractions(
    units: PhaseUnits,
    completedUnits: number
): {
    readingUnits: number;
    readFraction: number;
    hydrateFraction: number;
    applyFraction: number;
} {
    const readingUnits = units.setup + units.reading;
    const within = Math.max(0, completedUnits);
    const readingDone = Math.min(readingUnits, within);
    const hydrateDone = Math.min(units.hydrating, Math.max(0, within - readingUnits));
    const applyDone = Math.min(
        units.applying,
        Math.max(0, within - readingUnits - units.hydrating)
    );
    return {
        readingUnits,
        readFraction: readingUnits > 0 ? readingDone / readingUnits : 1,
        hydrateFraction: units.hydrating > 0 ? hydrateDone / units.hydrating : 1,
        applyFraction: units.applying > 0 ? applyDone / units.applying : 0,
    };
}

function runStateFromActive(active: {
    phase: "setup" | "reading" | "hydrating" | "applying" | "done";
    completedUnits: number;
    phaseUnits: PhaseUnits;
}): Extract<QueueItemRunState, { kind: "current" }> {
    let phase: QueuePhase;
    if (active.phase === "applying") {
        phase = "applying";
    } else if (active.phase === "hydrating") {
        phase = "hydrating";
    } else {
        phase = "reading";
    }
    return {
        kind: "current",
        phase,
        phaseUnits: active.phaseUnits,
        completedUnits: active.completedUnits,
    };
}

/**
 * True iff this queue item corresponds to the importable currently being
 * processed by the in-flight task session.
 */
export function isCurrentQueueItem(item: QueueItem): boolean {
    if (taskProgress === null) return false;
    const current = taskProgress.active;
    if (current === null) return false;
    if (item.kind === "importable") {
        const progressPath = queueItemProgressPath(item);
        if (progressPath === null) return false;
        return current.key === queueRowKey(item.type, item.identity, progressPath);
    }
    if (activeTaskPath === null) return false;
    return canonicalPath(item.sourcePath) === canonicalPath(activeTaskPath);
}
