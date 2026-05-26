/// <reference types="../../../CTAutocomplete" />

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
const PERSIST_PATH = "./htsw/eta-stats.json";
let loadedPersistedStats = false;
let persistScheduled = false;

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
    const key = kind;
    let entry = stats[key];
    if (entry === undefined) {
        entry = { count: 0, totalMs: 0, totalExpectedUnits: 0 };
        stats[key] = entry;
    }
    entry.count++;
    entry.totalMs += Math.max(0, elapsedMs);
    entry.totalExpectedUnits += expectedUnits;
    schedulePersist();
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
    loadPersistedStats();
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
    loadPersistedStats();
    for (const kind in stats) {
        delete stats[kind];
    }
    persistTimingStats();
}

function loadPersistedStats(): void {
    if (loadedPersistedStats) return;
    loadedPersistedStats = true;
    if (!FileLib.exists(PERSIST_PATH)) return;
    try {
        const raw = String(FileLib.read(PERSIST_PATH) ?? "");
        const parsed = JSON.parse(raw) as {
            stats?: { [kind: string]: MutableTimingStatsEntry | undefined };
        };
        const persisted = parsed.stats;
        if (persisted === undefined) return;
        for (const kind in persisted) {
            const entry = persisted[kind];
            if (entry === undefined) continue;
            if (
                typeof entry.count !== "number" ||
                typeof entry.totalMs !== "number" ||
                typeof entry.totalExpectedUnits !== "number"
            ) {
                continue;
            }
            stats[kind] = {
                count: Math.max(0, entry.count),
                totalMs: Math.max(0, entry.totalMs),
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
    setTimeout(() => {
        persistScheduled = false;
        persistTimingStats();
    }, 5000);
}

function persistTimingStats(): void {
    try {
        FileLib.write(
            PERSIST_PATH,
            JSON.stringify(
                {
                    version: 1,
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
