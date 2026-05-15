/// <reference types="../../../CTAutocomplete" />

import type { ActionListProgressPhase } from "./types";

export type TimedOperationKind =
    | "commandMenuWait"
    | "commandMessageWait"
    | "menuClickWait"
    | "messageClickWait"
    | "pageTurnWait"
    | "goBackWait"
    | "chatInput"
    | "anvilInput"
    | "itemSelect"
    | "reorderStep"
    | "sleep1000";

type TimedOp = {
    kind: TimedOperationKind;
    expectedUnits: number;
    startedAt: number;
};

type TimingStatsEntry = {
    count: number;
    totalMs: number;
    totalExpectedUnits: number;
    avgMs: number;
    avgMsPerExpectedUnit: number;
};

export type TimingStats = {
    [kind: string]: TimingStatsEntry | undefined;
};

type MutableTimingStatsEntry = {
    count: number;
    totalMs: number;
    totalExpectedUnits: number;
};

const stats: { [kind: string]: MutableTimingStatsEntry | undefined } = {};

/**
 * Per-phase budget-time accumulator. Tracks how many real ms were spent
 * inside each `withCurrentPhase(...)` window, paired with how many budget
 * units those ms covered. The ratio gives a calibrated ms/budget-unit
 * for each phase, which the GUI uses for phase-aware ETA — separate
 * buckets for reading vs hydrating vs applying so finishing one doesn't
 * poison the projection of the others.
 *
 * Persisted to disk across sessions (see `loadPhaseStatsFromDisk` /
 * `savePhaseStatsToDisk`) so the first import after a game restart
 * doesn't have to re-learn the user's ping from scratch.
 */
type PhaseStatsEntry = {
    totalMs: number;
    totalBudgetUnits: number;
};

const phaseStats: { [phase: string]: PhaseStatsEntry | undefined } = {};
let currentPhase: ActionListProgressPhase | null = null;
let phaseStatsLoaded = false;

/**
 * The phases whose timing we calibrate and persist. `diffing` is part of
 * `ActionListProgressPhase` for event-emission purposes but contributes
 * nothing to ETA — it's pure in-process compute. Centralising the
 * whitelist here keeps `recordTimedOp`, `savePhaseStatsToDisk`, and
 * `ensurePhaseStatsLoaded` in lockstep so we never persist a phase we
 * can't load back, or accept one on disk we don't write.
 */
type StatsTrackedPhase = "reading" | "hydrating" | "applying";
function isStatsTrackedPhase(phase: string): phase is StatsTrackedPhase {
    return phase === "reading" || phase === "hydrating" || phase === "applying";
}

const PHASE_STATS_PATH = "./htsw/eta-stats.json";

/**
 * Soft window for the per-phase running mean — once a phase has
 * accumulated this many budget units, future samples carry roughly
 * `1/WINDOW` of the weight relative to the existing average. Achieves
 * EWMA-like adaptivity (recent samples matter more) while reusing the
 * existing `totalMs / totalBudgetUnits` rate formula.
 *
 * Picked so a few hundred-unit importables don't get drowned out, but
 * a sustained shift in ping (e.g. swapping networks mid-session) shows
 * up within ~1-2 imports.
 */
const PHASE_STATS_WINDOW = 500;

export async function withCurrentPhase<T>(
    phase: ActionListProgressPhase,
    fn: () => Promise<T>
): Promise<T> {
    const previous = currentPhase;
    currentPhase = phase;
    try {
        return await fn();
    } finally {
        currentPhase = previous;
    }
}
export type PhaseStats = {
    [phase: string]:
        | { totalMs: number; totalBudgetUnits: number; msPerBudgetUnit: number }
        | undefined;
};

export function getPhaseStats(): PhaseStats {
    ensurePhaseStatsLoaded();
    const out: PhaseStats = {};
    for (const phase in phaseStats) {
        const entry = phaseStats[phase];
        if (entry === undefined) continue;
        out[phase] = {
            totalMs: entry.totalMs,
            totalBudgetUnits: entry.totalBudgetUnits,
            msPerBudgetUnit:
                entry.totalBudgetUnits <= 0 ? 0 : entry.totalMs / entry.totalBudgetUnits,
        };
    }
    return out;
}

export function resetPhaseStats(): void {
    for (const k in phaseStats) {
        delete phaseStats[k];
    }
    phaseStatsLoaded = true;
    savePhaseStatsToDisk();
}

function ensurePhaseStatsLoaded(): void {
    if (phaseStatsLoaded) return;
    phaseStatsLoaded = true;
    try {
        if (!FileLib.exists(PHASE_STATS_PATH)) return;
        const raw = String(FileLib.read(PHASE_STATS_PATH) ?? "");
        if (raw.trim() === "") return;
        const parsed = JSON.parse(raw) as {
            phases?: { [phase: string]: { totalMs?: number; totalBudgetUnits?: number } };
        };
        const phases = parsed?.phases;
        if (phases === undefined || phases === null) return;
        for (const phase in phases) {
            if (!isStatsTrackedPhase(phase)) continue;
            const entry = phases[phase];
            const totalMs = Number(entry?.totalMs);
            const totalBudgetUnits = Number(entry?.totalBudgetUnits);
            if (
                !isFinite(totalMs) ||
                !isFinite(totalBudgetUnits) ||
                totalMs < 0 ||
                totalBudgetUnits <= 0
            ) {
                continue;
            }
            phaseStats[phase] = { totalMs, totalBudgetUnits };
        }
    } catch (_e) {
        // ignore — start with empty stats
    }
}

export function savePhaseStatsToDisk(): void {
    try {
        const phases: {
            [phase: string]: { totalMs: number; totalBudgetUnits: number };
        } = {};
        for (const phase in phaseStats) {
            if (!isStatsTrackedPhase(phase)) continue;
            const entry = phaseStats[phase];
            if (entry === undefined) continue;
            phases[phase] = {
                totalMs: entry.totalMs,
                totalBudgetUnits: entry.totalBudgetUnits,
            };
        }
        FileLib.write(
            PHASE_STATS_PATH,
            JSON.stringify({ version: 1, phases }, null, 2),
            true
        );
    } catch (_e) {
        // ignore — persistence is best-effort
    }
}

function beginTimedOp(
    kind: TimedOperationKind,
    expectedUnits: number
): TimedOp {
    return {
        kind,
        expectedUnits,
        startedAt: Date.now(),
    };
}

function endTimedOp(op: TimedOp): void {
    const elapsed = Math.max(0, Date.now() - op.startedAt);
    recordTimedOp(op.kind, op.expectedUnits, elapsed);
}

export function recordTimedOp(
    kind: TimedOperationKind,
    expectedUnits: number,
    elapsedMs: number
): void {
    const key = kind;
    let entry = stats[key];
    if (entry === undefined) {
        entry = { count: 0, totalMs: 0, totalExpectedUnits: 0 };
        stats[key] = entry;
    }
    entry.count++;
    entry.totalMs += Math.max(0, elapsedMs);
    entry.totalExpectedUnits += expectedUnits;
    if (currentPhase !== null && isStatsTrackedPhase(currentPhase)) {
        ensurePhaseStatsLoaded();
        let phaseEntry = phaseStats[currentPhase];
        if (phaseEntry === undefined) {
            phaseEntry = { totalMs: 0, totalBudgetUnits: 0 };
            phaseStats[currentPhase] = phaseEntry;
        }
        // Soft-window the running mean: once the phase has accumulated
        // PHASE_STATS_WINDOW budget units, scale both totals down so the
        // mean stays roughly anchored to that window. This gives recent
        // samples ~`1/WINDOW` weight (EWMA-like) without changing the
        // `totalMs / totalBudgetUnits` rate formula.
        if (phaseEntry.totalBudgetUnits > PHASE_STATS_WINDOW) {
            const decay = PHASE_STATS_WINDOW / phaseEntry.totalBudgetUnits;
            phaseEntry.totalMs *= decay;
            phaseEntry.totalBudgetUnits *= decay;
        }
        phaseEntry.totalMs += Math.max(0, elapsedMs);
        phaseEntry.totalBudgetUnits += expectedUnits;
    }
}

export async function timed<T>(
    kind: TimedOperationKind,
    expectedUnits: number,
    fn: () => Promise<T>
): Promise<T> {
    const op = beginTimedOp(kind, expectedUnits);
    try {
        return await fn();
    } finally {
        endTimedOp(op);
    }
}

export function getTimingStats(): TimingStats {
    const out: TimingStats = {};
    for (const kind in stats) {
        const entry = stats[kind];
        if (entry === undefined) continue;
        out[kind] = {
            count: entry.count,
            totalMs: entry.totalMs,
            totalExpectedUnits: entry.totalExpectedUnits,
            avgMs: entry.count === 0 ? 0 : entry.totalMs / entry.count,
            avgMsPerExpectedUnit:
                entry.totalExpectedUnits <= 0
                    ? 0
                    : entry.totalMs / entry.totalExpectedUnits,
        };
    }
    return out;
}

export function resetTimingStats(): void {
    for (const kind in stats) {
        delete stats[kind];
    }
}
