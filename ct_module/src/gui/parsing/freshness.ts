/// <reference types="../../../CTAutocomplete" />

import { getMtimeMs } from "../lib/java";

/**
 * Settle-debounced change detection over a path→mtime fingerprint.
 * Extracted from the parse cache so the cache entry holds DATA and this
 * module owns the polling state machine.
 */

export type Fingerprint = { [path: string]: number };

// Minimum idle time after a completed fingerprint sweep. Longer sweeps use
// their own duration instead, keeping background checks from running
// continuously while preserving the small-project settle window.
export const FP_RECHECK_MS = 400;
// Stats per settledChange call. The caller runs once per tick, so a sweep of
// N referenced files spreads over ceil(N/BUDGET) ticks instead of landing as
// one N-stat spike — that spike was a visible hitch mid-import on big
// projects.
const FP_SWEEP_BUDGET = 16;

type FingerprintSweep = {
    /** Fingerprint keys captured at sweep start. */
    paths: string[];
    /** Next index in `paths` to stat. */
    index: number;
    /** Mtimes gathered so far. */
    acc: Fingerprint;
    /** `Date.now()` when this sweep started. */
    startedAt: number;
};

export type FingerprintFreshness = {
    /** `Date.now()` the last sweep COMPLETED (throttle). */
    checkedAt: number;
    /** Duration of the last completed sweep. */
    lastSweepDurationMs: number;
    /** Mtimes seen when a change was first noticed; drives the settle debounce. Null when idle. */
    pending: Fingerprint | null;
    /** In-progress sweep, statted a budget per call. Null when idle. */
    sweep: FingerprintSweep | null;
};

export function createFreshness(): FingerprintFreshness {
    return {
        checkedAt: Date.now(),
        lastSweepDurationMs: 0,
        pending: null,
        sweep: null,
    };
}

/** Mark just-checked: nothing pending, next sweep after the throttle. */
export function resetFreshness(freshness: FingerprintFreshness): void {
    freshness.checkedAt = Date.now();
    freshness.lastSweepDurationMs = 0;
    freshness.pending = null;
    freshness.sweep = null;
}

function sameMtimes(a: Fingerprint, b: Fingerprint): boolean {
    for (const p in a) {
        if (!Object.prototype.hasOwnProperty.call(a, p)) continue;
        if (a[p] !== b[p]) return false;
    }
    for (const p in b) {
        if (
            Object.prototype.hasOwnProperty.call(b, p) &&
            !Object.prototype.hasOwnProperty.call(a, p)
        ) {
            return false;
        }
    }
    return true;
}

export function isFreshnessCheckDue(freshness: FingerprintFreshness): boolean {
    if (freshness.sweep !== null) return true;
    const idleMs = Math.max(FP_RECHECK_MS, freshness.lastSweepDurationMs);
    return Date.now() - freshness.checkedAt >= idleMs;
}

// True when a fingerprinted file changed AND its mtimes have settled — the
// same new values seen on two consecutive completed sweeps. Until then (a
// save still writing, or a temp+rename mid-swap) the mtimes keep moving, so
// this returns false and the caller serves the existing parse rather than
// reading a half-written file. Each call stats at most FP_SWEEP_BUDGET
// files; a sweep completes across calls. Mutates the freshness bookkeeping.
export function settledChange(
    fingerprint: Fingerprint,
    freshness: FingerprintFreshness
): boolean {
    if (freshness.sweep === null) {
        if (!isFreshnessCheckDue(freshness)) return false;
        freshness.sweep = {
            paths: Object.keys(fingerprint),
            index: 0,
            acc: {},
            startedAt: Date.now(),
        };
    }
    const sweep = freshness.sweep;
    const end = Math.min(sweep.index + FP_SWEEP_BUDGET, sweep.paths.length);
    for (; sweep.index < end; sweep.index++) {
        const p = sweep.paths[sweep.index];
        sweep.acc[p] = getMtimeMs(p);
    }
    if (sweep.index < sweep.paths.length) return false;
    freshness.sweep = null;
    const completedAt = Date.now();
    freshness.checkedAt = completedAt;
    freshness.lastSweepDurationMs = completedAt - sweep.startedAt;
    const cur = sweep.acc;
    if (sameMtimes(fingerprint, cur)) {
        freshness.pending = null;
        return false;
    }
    if (freshness.pending === null || !sameMtimes(freshness.pending, cur)) {
        freshness.pending = cur;
        return false;
    }
    freshness.pending = null;
    return true;
}
