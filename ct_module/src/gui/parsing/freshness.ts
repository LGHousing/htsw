/// <reference types="../../../CTAutocomplete" />

import { getMtimeMs } from "../lib/java";

/**
 * Settle-debounced change detection over a path→mtime fingerprint.
 * Extracted from the parse cache so the cache entry holds DATA and this
 * module owns the polling state machine.
 */

export type Fingerprint = { [path: string]: number };

// How often the fingerprint is re-swept on a cache hit (≈ one stat per
// referenced file per interval); a change is acted on after it stays stable
// for one extra interval, so edit-to-refresh latency is ~1–2× this.
export const FP_RECHECK_MS = 400;
// Stats per settledChange call. The caller runs once per tick, so a sweep of
// N referenced files spreads over ceil(N/BUDGET) ticks instead of landing as
// one N-stat spike — that spike was a visible hitch mid-import on big
// projects.
const FP_SWEEP_BUDGET = 4;

type FingerprintSweep = {
    /** Fingerprint keys captured at sweep start. */
    paths: string[];
    /** Next index in `paths` to stat. */
    index: number;
    /** Mtimes gathered so far. */
    acc: Fingerprint;
};

export type FingerprintFreshness = {
    /** `Date.now()` the last sweep COMPLETED (throttle). */
    checkedAt: number;
    /** Mtimes seen when a change was first noticed; drives the settle debounce. Null when idle. */
    pending: Fingerprint | null;
    /** In-progress sweep, statted a budget per call. Null when idle. */
    sweep: FingerprintSweep | null;
};

export function createFreshness(): FingerprintFreshness {
    return { checkedAt: Date.now(), pending: null, sweep: null };
}

/** Mark just-checked: nothing pending, next sweep after the throttle. */
export function resetFreshness(freshness: FingerprintFreshness): void {
    freshness.checkedAt = Date.now();
    freshness.pending = null;
    freshness.sweep = null;
}

function sameMtimes(a: Fingerprint, b: Fingerprint): boolean {
    for (const p in a) {
        if (a[p] !== b[p]) return false;
    }
    return true;
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
        if (Date.now() - freshness.checkedAt < FP_RECHECK_MS) return false;
        freshness.sweep = { paths: Object.keys(fingerprint), index: 0, acc: {} };
    }
    const sweep = freshness.sweep;
    const end = Math.min(sweep.index + FP_SWEEP_BUDGET, sweep.paths.length);
    for (; sweep.index < end; sweep.index++) {
        const p = sweep.paths[sweep.index];
        sweep.acc[p] = getMtimeMs(p);
    }
    if (sweep.index < sweep.paths.length) return false;
    freshness.sweep = null;
    freshness.checkedAt = Date.now();
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
