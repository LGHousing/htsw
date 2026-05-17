/// <reference types="../../CTAutocomplete" />

/**
 * Per-import trace logger. Captures the full observed/desired state and
 * every plan/apply operation as JSON events, then writes one file per
 * run. Designed to be readable by both humans and (especially) the AI
 * pair-programmer for postmortem debugging — the chat log truncates
 * field values to ~30 chars via `shortVal`, which loses the information
 * needed to diagnose lore-truncation false positives, normalization
 * mismatches, etc.
 *
 * Off by default. Toggle via `/htsw trace on|off`. When enabled, every
 * import run writes a file like:
 *
 *     ./htsw/imports-trace/2026-05-13T16-04-58-789Z.json
 *
 * (The path is also chatted at the end of the run so the user / AI can
 * find the latest trace.)
 *
 * Design choices:
 * - Events buffer in memory for the whole run, then a single
 *   `FileLib.write` at end. Avoids per-event filesystem cost during the
 *   import and dodges any append-mode quirks.
 * - All event payloads are deep-cloned via JSON round-trip on capture,
 *   so post-capture mutation by the importer can't corrupt the trace.
 * - Best-effort: any failure (filesystem, JSON cycle, etc.) is silently
 *   swallowed. The trace exists to help debugging and must never abort
 *   an import.
 */

import { ensureParentDirs } from "../utils/filesystem";

// ── Configuration / state ───────────────────────────────────────────────

let enabled = false;

type TraceEvent = {
    /** Wall-clock relative to run start, in milliseconds. */
    t: number;
    phase: string;
    /** Importable identifier (`<type>:<identity>`) the event belongs to,
     *  or null for run-level events. */
    importable: string | null;
    data: unknown;
};

type RunState = {
    startedAt: number;
    queueSize: number;
    sourcePath: string | null;
    /** The importable currently being processed; tagged onto subsequent events. */
    activeImportable: string | null;
    events: TraceEvent[];
};

let run: RunState | null = null;

// ── Toggle ──────────────────────────────────────────────────────────────

export function setTraceEnabled(value: boolean): void {
    enabled = value;
}

export function isTraceEnabled(): boolean {
    return enabled;
}

// ── Run lifecycle ───────────────────────────────────────────────────────

/**
 * Begin a new trace run. Called from `startImport` once per Import-button
 * click (or `/import` invocation). Returns the path the trace will be
 * written to on `endTraceRun`, or null if tracing is off.
 */
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

/**
 * Tag subsequent events with this importable identifier. Pass null when
 * the run finishes one importable and is between (or done with) all.
 */
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

/**
 * Append a phase event with arbitrary data. The data is deep-cloned via
 * JSON serialization so subsequent mutation by the importer doesn't
 * corrupt the trace. If serialization throws (unlikely — Action/Condition
 * objects are plain), the event is logged as `<unserializable>`.
 */
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

/**
 * Finalize the trace, write the file, return the absolute-style path
 * (or null if tracing was off / nothing to write).
 */
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
    } catch (_e) {
        // Best-effort: trace file is debug aid, not import-critical.
    }
    run = null;
    return written ? path : null;
}

function computeRunFilePath(startedAt: number): string {
    const iso = new Date(startedAt).toISOString().replace(/[:.]/g, "-");
    return `./htsw/imports-trace/${iso}.json`;
}
