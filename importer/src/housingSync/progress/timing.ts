import { runtimeString } from "../../utils/runtimeString";
import { platform } from "../../platform";

export type TimedOperationKind =
    | "commandMenuWait"
    | "commandMessageWait"
    | "menuClickWait"
    | "messageClickWait"
    | "pageTurnWait"
    | "goBackWait"
    | "chatInput"
    | "signInput"
    | "anvilInput"
    | "itemInject"
    | "inventoryRestore"
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
    avgMsPerExpectedUnit: number;
    baselineMsPerExpectedUnit: number;
    /**
     * Total expected-units this kind has contributed over its lifetime. Used
     * as the weight when blending per-kind rates into a single ms/unit: a kind
     * that does more of the total work should pull the average toward its rate.
     */
    totalExpectedUnits: number;
};

export type TimingStats = {
    [kind: string]: TimingStatsEntry | undefined;
};

type MutableTimingStatsEntry = {
    count: number;
    ewmaMsPerUnit: number;
    ewmaSlowMsPerUnit: number;
    totalExpectedUnits: number;
};

const EWMA_ALPHA_FAST = 0.1;
const EWMA_ALPHA_SLOW = 0.02;
const EWMA_WARMUP = 10;
// A single op that stalls (server hiccup, GC pause) yields a per-unit sample
// many times the real rate. Clamp each post-warmup sample into this band
// around the stable (slow) EWMA before it feeds the averages, so one spike
// can't yank ms/u. Sustained drift still tracks — many clamped samples in
// the same direction still walk the average there.
const SAMPLE_CLAMP_RATIO = 3;

const stats: { [kind: string]: MutableTimingStatsEntry | undefined } = {};
const PERSIST_PATH = "./htsw/eta-stats.json";
// Bump whenever what one expected-unit means changes (see costs.ts). Stats
// saved under another version are dropped on load, since their ms/unit would
// skew estimates for a long time (the slow average only moves 2% per sample).
const PERSIST_VERSION = 2;
let loadedPersistedStats = false;
let persistScheduled = false;

// Per-import tally of expected-units run per kind, reset at import start.
// The ETA blends per-kind rates weighted by THIS import's op mix (not the
// lifetime mix), so a CHANGE_VAR-heavy import is priced at CHANGE_VAR rates.
const sessionUnits: { [kind: string]: number } = {};

export function resetSessionTiming(): void {
    for (const k in sessionUnits) delete sessionUnits[k];
}

export function getSessionTimingUnits(): { [kind: string]: number } {
    return sessionUnits;
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
    loadPersistedStats();
    if (expectedUnits <= 0) return;
    let sample = Math.max(0, elapsedMs) / expectedUnits;
    const key = kind;
    let entry = stats[key];
    if (entry === undefined) {
        entry = { count: 0, ewmaMsPerUnit: 0, ewmaSlowMsPerUnit: 0, totalExpectedUnits: 0 };
        stats[key] = entry;
    }
    entry.count++;
    entry.totalExpectedUnits += expectedUnits;
    sessionUnits[key] = (sessionUnits[key] ?? 0) + expectedUnits;
    const warmup = entry.count <= EWMA_WARMUP;
    if (!warmup && entry.ewmaSlowMsPerUnit > 0) {
        const lo = entry.ewmaSlowMsPerUnit / SAMPLE_CLAMP_RATIO;
        const hi = entry.ewmaSlowMsPerUnit * SAMPLE_CLAMP_RATIO;
        sample = Math.min(hi, Math.max(lo, sample));
    }
    const alphaFast = warmup ? 1 / entry.count : EWMA_ALPHA_FAST;
    const alphaSlow = warmup ? 1 / entry.count : EWMA_ALPHA_SLOW;
    entry.ewmaMsPerUnit = alphaFast * sample + (1 - alphaFast) * entry.ewmaMsPerUnit;
    entry.ewmaSlowMsPerUnit = alphaSlow * sample + (1 - alphaSlow) * entry.ewmaSlowMsPerUnit;
    schedulePersist();
}

export function timed<T>(
    kind: TimedOperationKind,
    expectedUnits: number,
    fn: () => Promise<T>
): Promise<T> & { cleanupWaiter?: () => void } {
    const op = beginTimedOp(kind, expectedUnits);
    const inner = fn();
    const wrapped = inner.then(
        (v): T => { endTimedOp(op); return v; },
        // Do NOT record on the error path. A timed-out, cancelled, or
        // otherwise-failed operation isn't a representative duration — recording
        // its (often multi-second) elapsed time poisons the EWMA cost model and
        // wrecks the ETA. Only successful completions calibrate cost.
        (e: unknown): T => { throw e; }
    ) as Promise<T> & { cleanupWaiter?: () => void };
    // Forward cleanupWaiter from the inner waiter (if present) so a racing
    // caller can cancel the underlying waitFor container before it leaks.
    const innerCleanup = (inner as Promise<T> & { cleanupWaiter?: () => void }).cleanupWaiter;
    if (innerCleanup !== undefined) wrapped.cleanupWaiter = innerCleanup;
    return wrapped;
}

export function getTimingStats(): TimingStats {
    loadPersistedStats();
    const out: TimingStats = {};
    for (const kind in stats) {
        const entry = stats[kind];
        if (entry === undefined) continue;
        out[kind] = {
            count: entry.count,
            avgMsPerExpectedUnit: entry.ewmaMsPerUnit,
            baselineMsPerExpectedUnit: entry.ewmaSlowMsPerUnit,
            totalExpectedUnits: entry.totalExpectedUnits,
        };
    }
    return out;
}

export function resetTimingStats(): void {
    loadPersistedStats();
    for (const kind in stats) {
        delete stats[kind];
    }
    persistTimingStats();
}

type PersistedEntry = {
    count?: number;
    ewmaMsPerUnit?: number;
    ewmaSlowMsPerUnit?: number;
    totalExpectedUnits?: number;
};

function loadPersistedStats(): void {
    if (loadedPersistedStats) return;
    loadedPersistedStats = true;
    if (!platform().fileLib.exists(PERSIST_PATH)) return;
    try {
        const raw = runtimeString(platform().fileLib.read(PERSIST_PATH));
        const parsed = JSON.parse(raw) as {
            version?: number;
            stats?: { [kind: string]: PersistedEntry | undefined };
        };
        if (parsed.version !== PERSIST_VERSION || parsed.stats === undefined) return;
        for (const kind in parsed.stats) {
            const entry = parsed.stats[kind];
            if (
                entry === undefined ||
                typeof entry.count !== "number" ||
                typeof entry.ewmaMsPerUnit !== "number" ||
                typeof entry.ewmaSlowMsPerUnit !== "number" ||
                typeof entry.totalExpectedUnits !== "number"
            ) {
                continue;
            }
            stats[kind] = {
                count: Math.max(0, entry.count),
                ewmaMsPerUnit: Math.max(0, entry.ewmaMsPerUnit),
                ewmaSlowMsPerUnit: Math.max(0, entry.ewmaSlowMsPerUnit),
                totalExpectedUnits: Math.max(0, entry.totalExpectedUnits),
            };
        }
    } catch (_error) {
        return;
    }
}

function schedulePersist(): void {
    if (persistScheduled) return;
    persistScheduled = true;
    platform().setTimeout(() => {
        persistScheduled = false;
        persistTimingStats();
    }, 5000);
}

function persistTimingStats(): void {
    try {
        platform().fileLib.write(
            PERSIST_PATH,
            JSON.stringify(
                {
                    version: PERSIST_VERSION,
                    updatedAt: new Date().toISOString(),
                    stats,
                },
                null,
                2
            ),
            true
        );
    } catch (_error) {
        return;
    }
}
