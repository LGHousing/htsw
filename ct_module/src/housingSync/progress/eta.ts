import type { TaskProgress, ProgressPhase } from "./types";
import { getTimingStats, getSessionTimingUnits } from "./timing";

const MS_PER_UNIT_PRIOR = 150;
// Strength of the lifetime-mix prior (in units) before the current import's
// observed op-mix dominates the rate blend.
const PRIOR_UNITS = 40;

/**
 * Smoothed ETA display: a wall-clock countdown that prefers a steady ~1s/sec
 * descent over faithfully tracking the chunky honest candidate
 * (`remaining × msPerUnit`, which is flat between progress events then steps).
 *
 * Each frame ticks the displayed value down by elapsed wall-clock
 * (`predicted = displayed − dt`) for steady motion, then reconciles with the
 * candidate by case:
 *
 * - **Above the candidate** (the normal apply case — the down-tick has run
 *   ahead of completed work): descend, but clamp the rate into
 *   `[MIN_DOWN_RATE, MAX_DOWN_RATE]` s/sec so a chunk completing never shows
 *   as a multi-second-per-second slide, and the value never freezes either.
 *   When the candidate is more than `JUMP_GAP_SECONDS` below the line, take
 *   the difference as one visible jump instead of a long fast glide.
 * - **At/below the candidate** (a genuine stall, or a re-estimate upward):
 *   ease gently toward it with a ~3s time constant — coast to a near-stop a
 *   few seconds under the candidate rather than draining to zero, and never
 *   sawtooth upward in a stall.
 *
 * Net: a clock-like second most of the time, with a rare honest jump on a
 * drastic re-estimate, rather than a continuously-variable "lying" second.
 */
const EASE_TAU_MS = 3000;
const SNAP_BELOW_SECONDS = 0.5;
const MAX_DOWN_RATE = 1.4;
const MIN_DOWN_RATE = 0.7;
const JUMP_GAP_SECONDS = 4;

type EtaSmoother = { displayed: number; at: number };

export type EtaCalculator = {
    getTotal(progress: TaskProgress | null, taskStartedAt: number | null): number | null;
    getPhase(progress: TaskProgress | null, taskStartedAt: number | null): number | null;
};

function ease(prev: EtaSmoother | null, candidate: number, now: number): EtaSmoother {
    if (prev === null) return { displayed: candidate, at: now };
    // Snap on a drastic upward jump rather than crawling over seconds. This is
    // the startup case — the smoother first sees the placeholder `totalUnits: 1`
    // (candidate ≈ 0) before `sessionStarted` installs the real total, and
    // also any large mid-run re-estimate. Easing those would show a slow ramp
    // up to the real ETA ("0 → 2min"). Normal tracking still eases.
    if (candidate > prev.displayed * 2 + 3) {
        return { displayed: candidate, at: now };
    }
    const dt = Math.max(0, now - prev.at);
    const dtSec = dt / 1000;
    const predicted = prev.displayed - dtSec;
    const alpha = 1 - Math.exp(-dt / EASE_TAU_MS);
    const eased = predicted + (candidate - predicted) * alpha;

    let next: number;
    if (prev.displayed > candidate) {
        if (prev.displayed - candidate > JUMP_GAP_SECONDS) {
            next = candidate;
        } else {
            const fastest = prev.displayed - dtSec * MAX_DOWN_RATE;
            const slowest = prev.displayed - dtSec * MIN_DOWN_RATE;
            next = Math.min(slowest, Math.max(fastest, eased));
            if (next < candidate) next = candidate;
        }
    } else {
        next = eased;
    }
    if (next < 0) next = 0;
    // Don't let the ease leave a tiny residual hanging near the end.
    if (candidate <= 0 && next < SNAP_BELOW_SECONDS) next = 0;
    return { displayed: next, at: now };
}

// NOTE: the getters below advance smoother state as a side effect of being
// called (each call eases toward the candidate). This is safe under any call
// frequency — including multiple callers per frame (render + trace sampler) —
// ONLY because the easing math is wall-clock-dt based: two calls split the
// elapsed time rather than double-stepping. Don't replace the dt-based ease
// with a fixed per-call step.
export function createEtaCalculator(): EtaCalculator {
    let totalEta: EtaSmoother | null = null;
    let phaseEta: EtaSmoother | null = null;

    return {
        getTotal(progress, _importStartedAt) {
            if (progress === null) return null;
            const now = Date.now();
            const remainingUnits = Math.max(
                0,
                progress.totalUnits - progress.completedUnits
            );
            const candidate = (remainingUnits * currentMsPerUnit()) / 1000;
            totalEta = ease(totalEta, candidate, now);
            return totalEta.displayed;
        },
        getPhase(progress, _importStartedAt) {
            if (progress === null || progress.active === null) {
                return null;
            }
            const phase = progress.active.phase;
            if (phase === "done") return null;
            const now = Date.now();
            const remainingUnits = phaseRemainingUnits(progress, phase);
            const candidate = (remainingUnits * currentMsPerUnit()) / 1000;
            phaseEta = ease(phaseEta, candidate, now);
            return phaseEta.displayed;
        },
    };
}

const MS_PER_UNIT_TTL_MS = 1000;
let cachedMsPerUnit: { at: number; value: number } | null = null;

export function currentMsPerUnit(): number {
    const now = Date.now();
    if (cachedMsPerUnit !== null && now - cachedMsPerUnit.at < MS_PER_UNIT_TTL_MS) {
        return cachedMsPerUnit.value;
    }
    const stats = getTimingStats();
    const session = getSessionTimingUnits();
    // Blend per-kind rates into one ms/unit, weighted by THIS import's op mix
    // — the per-kind units it has actually run so far — so the rate reflects
    // the work being done now, not the lifetime average across all past
    // imports. (Lifetime weighting prices a CHANGE_VAR-heavy import at the
    // historical mix and runs ~30% high.) A lifetime-shaped prior of
    // `PRIOR_UNITS` keeps the very start sane before enough ops are observed;
    // the session mix takes over as it accumulates past the prior.
    //
    // Uses each kind's *slow* (baseline) EWMA — a stable rate, not one that
    // chases every op. The fast EWMA is only for the `/htsw eta` trend arrow.
    let lifeTotal = 0;
    for (const kind in stats) {
        const entry = stats[kind];
        if (entry !== undefined) lifeTotal += entry.totalExpectedUnits;
    }
    let weightedSum = 0;
    let weightTotal = 0;
    for (const kind in stats) {
        const entry = stats[kind];
        if (entry === undefined || entry.count === 0) continue;
        const rate = entry.baselineMsPerExpectedUnit;
        if (rate <= 0) continue;
        const lifeShare = lifeTotal > 0 ? entry.totalExpectedUnits / lifeTotal : 0;
        const weight = (session[kind] ?? 0) + lifeShare * PRIOR_UNITS;
        weightedSum += rate * weight;
        weightTotal += weight;
    }
    const value = weightTotal === 0 ? MS_PER_UNIT_PRIOR : weightedSum / weightTotal;
    cachedMsPerUnit = { at: now, value };
    return value;
}

function phaseRemainingUnits(progress: TaskProgress, phase: ProgressPhase): number {
    const current = progress.active;
    if (current === null) return 0;
    const units = current.phaseUnits;
    const phaseStart =
        phase === "setup"
            ? 0
            : phase === "reading"
              ? units.setup
              : phase === "hydrating"
                ? units.setup + units.reading
                : units.setup + units.reading + units.hydrating;
    const phaseLength = units[phase];
    const phaseEnd = phaseStart + phaseLength;
    const within = current.completedUnits;
    if (within >= phaseEnd) return 0;
    if (within <= phaseStart) return phaseLength;
    return Math.max(0, phaseEnd - within);
}

