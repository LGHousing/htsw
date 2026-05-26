import type { ImportEvent } from "../importEvents";
import type { ImportProgress } from "./types";

let enabled = false;
let path: string | null = null;
let buffer = "";

function activeSnapshot(progress: ImportProgress | null): unknown {
    if (progress === null || progress.active === null) return null;
    return {
        key: progress.active.key,
        phase: progress.active.phase,
        completedUnits: progress.active.completedUnits,
        totalUnits: progress.active.totalUnits,
        phaseUnits: progress.active.phaseUnits,
        sync: progress.active.sync,
    };
}

function progressSnapshot(progress: ImportProgress | null): unknown {
    if (progress === null) return null;
    return {
        completedUnits: progress.completedUnits,
        totalUnits: progress.totalUnits,
        rows: progress.rows,
        active: activeSnapshot(progress),
    };
}

function eventSnapshot(event: ImportEvent): unknown {
    if (event.kind === "progress") {
        return {
            kind: event.kind,
            scope: event.scope,
            progress: event.progress,
        };
    }
    if (event.kind === "setupStep") {
        return {
            kind: event.kind,
            completed: event.completed,
            total: event.total,
            label: event.label,
        };
    }
    if (event.kind === "importableStarted") {
        return {
            kind: event.kind,
            key: event.key,
            type: event.type,
            identity: event.identity,
            setupUnits: event.setupUnits,
            initialUnits: event.initialUnits,
        };
    }
    if (event.kind === "importableFinished") {
        return {
            kind: event.kind,
            key: event.key,
            status: event.status,
        };
    }
    return { kind: event.kind };
}

function append(entry: unknown): void {
    if (!enabled || path === null) return;
    buffer += JSON.stringify({
        at: Date.now(),
        entry,
    }) + "\n";
    FileLib.write(path, buffer, true);
}

export function setProgressTraceEnabled(next: boolean): string | null {
    enabled = next;
    if (enabled) {
        path = `./htsw/progress-trace-${Date.now()}.jsonl`;
        buffer = "";
        append({ kind: "traceStarted" });
    } else {
        append({ kind: "traceStopped" });
    }
    return path;
}

export function getProgressTracePath(): string | null {
    return path;
}

export function isProgressTraceEnabled(): boolean {
    return enabled;
}

export function traceProgressEvent(
    event: ImportEvent,
    before: ImportProgress,
    after: ImportProgress
): void {
    append({
        kind: "event",
        event: eventSnapshot(event),
        before: progressSnapshot(before),
        after: progressSnapshot(after),
        delta: {
            completedUnits: after.completedUnits - before.completedUnits,
            totalUnits: after.totalUnits - before.totalUnits,
            activeCompletedUnits:
                (after.active?.completedUnits ?? 0) -
                (before.active?.completedUnits ?? 0),
            activeTotalUnits:
                (after.active?.totalUnits ?? 0) -
                (before.active?.totalUnits ?? 0),
        },
    });
}

export function traceEtaSnapshot(entry: unknown): void {
    append({
        kind: "eta",
        snapshot: entry,
    });
}

export function traceDebugSnapshot(label: string, entry: unknown): void {
    append({
        kind: "debug",
        label,
        snapshot: entry,
    });
}
