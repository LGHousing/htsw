import { getPhaseStats } from "./timing";
import type { ImportProgress } from "./types";

/**
 * Baseline ms/budget-unit per phase. Used until real observed timing
 * data is collected (persisted phase stats from a prior session take
 * precedence as soon as the file exists). With the post-rebalance COST
 * values, the per-op ms/u band is tight around ~150 across all three
 * phases, so a single shared value is honest:
 *   applying observed: ~148 ms/u (n=3425u over 506s)
 *   reading observed: pageTurn-dominated, ~152 ms/u post-rebalance
 *   hydrating observed: menuClick/goBack mix, ~150 ms/u post-rebalance
 *
 * Diffing isn't tracked: it's pure in-process compute, ~1-5ms per call,
 * and contributes nothing meaningful to ETA.
 *
 * To re-validate / refresh:
 *   1. `/htsw eta reset` — clear samples (also wipes the persisted file)
 *   2. Run a representative import
 *   3. `/htsw eta` to inspect, `/htsw eta dump` to snapshot to JSON
 *   4. Update these constants from the measured values
 */
const DEFAULT_MS_PER_UNIT_BY_PHASE: {
    [k in "reading" | "hydrating" | "applying"]: number;
} = {
    reading: 150,
    hydrating: 150,
    applying: 150,
};

/** Generic fallback when callers ask outside the tracked phases. */
const DEFAULT_MS_PER_UNIT = 150;

function msPerUnitForPhase(phase: "reading" | "hydrating" | "applying"): number {
    const stats = getPhaseStats();
    const entry = stats[phase];
    if (entry === undefined || entry.totalBudgetUnits <= 0) {
        return DEFAULT_MS_PER_UNIT_BY_PHASE[phase];
    }
    return entry.msPerBudgetUnit;
}

/**
 * Project total remaining seconds for the in-flight import. Phase-aware
 * within the current importable (each phase contributes via its own
 * observed ms/budget-unit), plus a generic future-importable bucket
 * priced at the applying rate. Returns null when no import is active.
 */
function recompute(progress: ImportProgress): number | null {
    // Within-importable phase breakdown using the live phaseBudget.
    let remainingMs = 0;
    if (progress.phaseBudget !== null) {
        const pb = progress.phaseBudget;
        const phaseOrder: Array<"reading" | "hydrating" | "applying"> = [
            "reading",
            "hydrating",
            "applying",
        ];
        // Cumulative budget consumed up to (not including) each phase.
        const phaseStartCum: { [k: string]: number } = {
            reading: 0,
            hydrating: pb.readPart,
            applying: pb.readPart + pb.hydratePart,
        };
        const phasePart: { [k: string]: number } = {
            reading: pb.readPart,
            hydrating: pb.hydratePart,
            applying: pb.applyPart,
        };
        // Position inside the current importable.
        const within = progress.estimatedCompleted - progress.weightCompleted;
        const currentPhaseFromEvent: "reading" | "hydrating" | "applying" | null =
            progress.phase === "reading" ||
            progress.phase === "hydrating" ||
            progress.phase === "applying"
                ? progress.phase
                : null;
        for (const ph of phaseOrder) {
            const phStart = phaseStartCum[ph];
            const phLen = phasePart[ph];
            const phEnd = phStart + phLen;
            let consumedInPhase: number;
            if (currentPhaseFromEvent === ph) {
                consumedInPhase = Math.min(phLen, Math.max(0, within - phStart));
            } else if (within >= phEnd) {
                consumedInPhase = phLen;
            } else if (within < phStart) {
                consumedInPhase = 0;
            } else {
                // Cursor is mid-phase but the event reports a different
                // phase — trust the cursor.
                consumedInPhase = Math.min(phLen, Math.max(0, within - phStart));
            }
            const remainingInPhase = Math.max(0, phLen - consumedInPhase);
            if (remainingInPhase > 0) {
                remainingMs += remainingInPhase * msPerUnitForPhase(ph);
            }
        }
    } else {
        // Pre-action-list phase (opening / starting / writingKnowledge).
        const within = Math.max(
            0,
            progress.weightCurrent - (progress.estimatedCompleted - progress.weightCompleted)
        );
        remainingMs += within * DEFAULT_MS_PER_UNIT;
    }

    const remainingFutureWeight = Math.max(
        0,
        progress.weightTotal - progress.weightCompleted - progress.weightCurrent
    );
    if (remainingFutureWeight > 0) {
        remainingMs += remainingFutureWeight * msPerUnitForPhase("applying");
    }

    if (!isFinite(remainingMs) || remainingMs < 0) return null;
    return remainingMs / 1000;
}

/**
 * Cached overall ETA from the most recent progress event, decremented
 * by elapsed wall time so the displayed countdown ticks down between
 * events instead of freezing.
 */
let cachedEtaSeconds: number | null = null;
let cachedEtaComputedAt: number | null = null;

/**
 * Called by `setImportProgress` whenever a new event arrives, so the
 * next read recomputes against the fresh state.
 */
export function resetEtaCache(): void {
    cachedEtaSeconds = null;
    cachedEtaComputedAt = null;
}

/**
 * Total remaining seconds for the in-flight import, with two safety
 * properties:
 *
 * 1. **Ticks down between events** — both the cached overall value and
 *    the current-importable floor decay linearly by elapsed wall time
 *    so the UI updates smoothly even when progress events are sparse
 *    (e.g. during a multi-second chat/anvil input).
 * 2. **Never undershoots the current importable** — the displayed
 *    value is `max(decayed, currentImportableRemaining - elapsed)`.
 *    Fixes the "overall ETA reads 0s while the current importable
 *    still says 14s left" bug that occurred when a long apply op ran
 *    longer than the previously-cached value, while still letting both
 *    sides count down together when no new event arrives.
 */
export function getImportEtaSeconds(progress: ImportProgress | null): number | null {
    if (progress === null) return null;
    if (cachedEtaSeconds === null || cachedEtaComputedAt === null) {
        cachedEtaSeconds = recompute(progress);
        cachedEtaComputedAt = Date.now();
        if (cachedEtaSeconds === null) return null;
    }
    const elapsed = (Date.now() - cachedEtaComputedAt) / 1000;
    const decayed = Math.max(0, cachedEtaSeconds - elapsed);
    const currentImportableSnapshot = getCurrentImportableEtaSeconds(progress);
    const currentImportableDecayed =
        currentImportableSnapshot === null
            ? 0
            : Math.max(0, currentImportableSnapshot - elapsed);
    return Math.max(decayed, currentImportableDecayed);
}

/**
 * Remaining seconds for *just the current importable*, decoupled from
 * the queue-wide ETA. Always recomputed (no cached decay) since it's
 * cheap and the caller of `getImportEtaSeconds` consults this on every
 * read for the `max(...)` floor.
 */
export function getCurrentImportableEtaSeconds(
    progress: ImportProgress | null
): number | null {
    if (progress === null) return null;
    const breakdown = getImportEtaBreakdown(progress);
    if (breakdown === null) return null;
    return breakdown.readSeconds + breakdown.hydrateSeconds + breakdown.applySeconds;
}

export type ImportEtaBreakdown = {
    readSeconds: number;
    hydrateSeconds: number;
    applySeconds: number;
    futureImportableSeconds: number;
    futureImportableCount: number;
};

/**
 * Per-phase breakdown of the *current importable's* remaining work,
 * plus a separate bucket for everything-after-this-importable. Lets
 * the UI show where the projected time is going.
 */
export function getImportEtaBreakdown(
    progress: ImportProgress | null
): ImportEtaBreakdown | null {
    if (progress === null) return null;
    let readMs = 0;
    let hydrateMs = 0;
    let applyMs = 0;
    if (progress.phaseBudget !== null) {
        const pb = progress.phaseBudget;
        const within = progress.estimatedCompleted - progress.weightCompleted;
        const phaseStartCum: { [k: string]: number } = {
            reading: 0,
            hydrating: pb.readPart,
            applying: pb.readPart + pb.hydratePart,
        };
        const remainingIn = (
            ph: "reading" | "hydrating" | "applying",
            phLen: number
        ): number => {
            const phStart = phaseStartCum[ph];
            const phEnd = phStart + phLen;
            if (within >= phEnd) return 0;
            if (within < phStart) return phLen;
            return Math.max(0, phEnd - within);
        };
        readMs = remainingIn("reading", pb.readPart) * msPerUnitForPhase("reading");
        hydrateMs =
            remainingIn("hydrating", pb.hydratePart) * msPerUnitForPhase("hydrating");
        applyMs = remainingIn("applying", pb.applyPart) * msPerUnitForPhase("applying");
    } else {
        // Pre-action-list phase. Treat all current work as "applying"
        // for breakdown display.
        const within = Math.max(
            0,
            progress.weightCurrent - (progress.estimatedCompleted - progress.weightCompleted)
        );
        applyMs = within * msPerUnitForPhase("applying");
    }
    const futureWeight = Math.max(
        0,
        progress.weightTotal - progress.weightCompleted - progress.weightCurrent
    );
    const futureMs = futureWeight * msPerUnitForPhase("applying");
    const futureCount = Math.max(0, progress.total - progress.completed - 1);
    return {
        readSeconds: readMs / 1000,
        hydrateSeconds: hydrateMs / 1000,
        applySeconds: applyMs / 1000,
        futureImportableSeconds: futureMs / 1000,
        futureImportableCount: futureCount,
    };
}
