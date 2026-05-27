/// <reference types="../../CTAutocomplete" />

import { ensureParentDirs } from "../utils/filesystem";

let enabled = false;

type TraceEvent = {
    t: number;
    phase: string;
    importable: string | null;
    data: unknown;
};

type RunState = {
    startedAt: number;
    queueSize: number;
    sourcePath: string | null;
    activeImportable: string | null;
    events: TraceEvent[];
};

let run: RunState | null = null;

export function setTraceEnabled(value: boolean): void {
    enabled = value;
}

export function isTraceEnabled(): boolean {
    return enabled;
}

export function beginTraceRun(opts: {
    queueSize: number;
    sourcePath?: string;
    trustMode: boolean;
}): string | null {
    if (!enabled) return null;
    run = {
        startedAt: Date.now(),
        queueSize: opts.queueSize,
        sourcePath: opts.sourcePath ?? null,
        activeImportable: null,
        events: [],
    };
    pushEvent("run-begin", {
        startedAt: new Date(run.startedAt).toISOString(),
        queueSize: opts.queueSize,
        sourcePath: opts.sourcePath ?? null,
        trustMode: opts.trustMode,
    });
    return computeRunFilePath(run.startedAt);
}

export function setTraceImportable(
    identifier: string | null,
    details?: { type?: string; identity?: string; sourcePath?: string }
): void {
    if (!enabled || run === null) return;
    run.activeImportable = identifier;
    if (identifier !== null) {
        pushEvent("importable-begin", {
            type: details?.type ?? null,
            identity: details?.identity ?? null,
            sourcePath: details?.sourcePath ?? null,
        });
    }
}

export function traceEvent(phase: string, data: unknown): void {
    if (!enabled || run === null) return;
    pushEvent(phase, data);
}

function pushEvent(phase: string, data: unknown): void {
    if (run === null) return;
    let cloned: unknown;
    try {
        cloned = data === undefined ? null : JSON.parse(JSON.stringify(data));
    } catch (_e) {
        cloned = "<unserializable>";
    }
    run.events.push({
        t: Date.now() - run.startedAt,
        phase,
        importable: run.activeImportable,
        data: cloned,
    });
}

export function endTraceRun(summary: {
    imported: number;
    skipped: number;
    failed: number;
    cancelled?: boolean;
}): string | null {
    if (!enabled || run === null) return null;
    const finishedAt = Date.now();
    pushEvent("run-end", {
        ...summary,
        elapsedMs: finishedAt - run.startedAt,
    });
    const path = computeRunFilePath(run.startedAt);
    const payload = {
        startedAt: new Date(run.startedAt).toISOString(),
        finishedAt: new Date(finishedAt).toISOString(),
        elapsedMs: finishedAt - run.startedAt,
        sourcePath: run.sourcePath,
        queueSize: run.queueSize,
        summary: {
            imported: summary.imported,
            skipped: summary.skipped,
            failed: summary.failed,
            cancelled: summary.cancelled === true,
        },
        events: run.events,
    };
    let written = false;
    try {
        ensureParentDirs(path);
        FileLib.write(path, JSON.stringify(payload, null, 2), true);
        written = true;
    } catch (_e) {}
    run = null;
    return written ? path : null;
}

function computeRunFilePath(startedAt: number): string {
    const iso = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
    return `./htsw/imports-trace/${iso}.json`;
}
