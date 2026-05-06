import { COST } from "./costs";

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

export type TimedOp = {
    kind: TimedOperationKind;
    expectedUnits: number;
    startedAt: number;
};

export type TimingStatsEntry = {
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

export function beginTimedOp(
    kind: TimedOperationKind,
    expectedUnits: number
): TimedOp {
    return {
        kind,
        expectedUnits,
        startedAt: Date.now(),
    };
}

export function endTimedOp(op: TimedOp): void {
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

export function defaultExpectedUnits(kind: TimedOperationKind): number {
    if (kind === "commandMenuWait") return COST.commandMenuWait;
    if (kind === "commandMessageWait") return COST.commandMessageWait;
    if (kind === "menuClickWait") return COST.menuClickWait;
    if (kind === "messageClickWait") return COST.messageClickWait;
    if (kind === "pageTurnWait") return COST.pageTurnWait;
    if (kind === "goBackWait") return COST.goBackWait;
    if (kind === "chatInput") return COST.chatInput;
    if (kind === "anvilInput") return COST.anvilInput;
    if (kind === "itemSelect") return COST.itemSelect;
    if (kind === "reorderStep") return COST.reorderStep;
    return COST.guaranteedSleep1000;
}
