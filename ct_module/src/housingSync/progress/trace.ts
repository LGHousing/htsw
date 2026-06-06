/// <reference types="../../../CTAutocomplete" />

/**
 * Minimal progress-event trace. When enabled, every reduced ImportEvent
 * appends a line to a JSONL file with the before/after session counts and
 * the active importable's phase/units — enough to pin which event moves
 * the ETA (e.g. a totalUnits jump mid-conditional). Off by default; toggled
 * via `/htsw eta trace [on|off]`.
 */

import type { ImportEvent } from "../importEvents";
import type { ImportProgress } from "./types";
import { currentMsPerUnit } from "./eta";

const PATH = "./htsw/progress-trace.jsonl";
const TICK_INTERVAL_MS = 100;

let enabled = false;
let buffer = "";
let traceStartedAt = 0;

/**
 * Periodic sampler of the *displayed* ETA. Set by the GUI layer (which owns
 * the EtaCalculator). Returns null when no import is running. Lets the trace
 * capture the value the user actually sees between progress events — the
 * event-only log can't show the smoothing/countdown behavior in the gaps.
 */
export type TraceSample = {
    etaSec: number | null;
    phaseEtaSec: number | null;
    msPerUnit: number;
    remaining: number;
    completed: number;
    total: number;
};

let sampler: (() => TraceSample | null) | null = null;

export function setProgressTraceSampler(fn: () => TraceSample | null): void {
    sampler = fn;
}

let lastTickAt = 0;

export function setProgressTraceEnabled(next: boolean): string {
    enabled = next;
    if (enabled) {
        buffer = "";
        traceStartedAt = Date.now();
        lastTickAt = 0;
        FileLib.write(PATH, "", true);
    }
    return PATH;
}

/**
 * Sample the displayed ETA. Called from the GUI render loop (which keeps
 * running during an import, between the importer task's awaits) rather than
 * a `setTimeout` — the timer shares the busy game thread and starves exactly
 * during heavy work, so it under-samples where it matters. Throttled to
 * `TICK_INTERVAL_MS` so we don't write every frame. No-op unless tracing.
 */
export function sampleProgressTraceTick(): void {
    if (!enabled || sampler === null) return;
    const now = Date.now();
    if (now - lastTickAt < TICK_INTERVAL_MS) return;
    lastTickAt = now;
    const s = sampler();
    if (s === null) return;
    buffer +=
        JSON.stringify({
            kind: "tick",
            at: now,
            tMs: now - traceStartedAt,
            etaSec: s.etaSec === null ? null : round(s.etaSec),
            phaseEtaSec: s.phaseEtaSec === null ? null : round(s.phaseEtaSec),
            msPerUnit: round(s.msPerUnit),
            remaining: round(s.remaining),
            completed: round(s.completed),
            total: round(s.total),
        }) + "\n";
    FileLib.write(PATH, buffer, true);
}

export function traceConditionOp(info: {
    opKind: "add" | "edit" | "delete" | "noteOnly";
    conditionType: string;
    units: number;
    invertChanged?: boolean;
    fieldsChanged?: string[];
}): void {
    if (!enabled) return;
    const now = Date.now();
    buffer +=
        JSON.stringify({
            kind: "conditionOp",
            at: now,
            tMs: now - traceStartedAt,
            opKind: info.opKind,
            conditionType: info.conditionType,
            units: round(info.units),
            invertChanged: info.invertChanged,
            fieldsChanged: info.fieldsChanged,
        }) + "\n";
    FileLib.write(PATH, buffer, true);
}

export function isProgressTraceEnabled(): boolean {
    return enabled;
}

export function getProgressTracePath(): string {
    return PATH;
}

export function traceProgressEvent(
    event: ImportEvent,
    before: ImportProgress,
    after: ImportProgress
): void {
    if (!enabled) return;
    const scope = event.kind === "progress" ? event.scope.kind : "";
    const path =
        event.kind === "progress" && event.scope.kind === "nestedActionList"
            ? event.scope.path
            : "";
    const msPerUnit = currentMsPerUnit();
    const remaining = Math.max(0, after.totalUnits - after.completedUnits);
    const eventNow = Date.now();
    const ev = event as { op?: string; actionType?: string; fieldsChanged?: string[] };
    buffer +=
        JSON.stringify({
            kind: event.kind,
            at: eventNow,
            tMs: eventNow - traceStartedAt,
            scope,
            path,
            // Op identity for operationStarted/Completed — lets the analysis
            // attribute actual elapsed time to a specific op type and compare
            // it against the cost model's predicted units for that op.
            op: ev.op,
            actionType: ev.actionType,
            fieldsChanged: ev.fieldsChanged,
            phase: after.active?.phase ?? null,
            beforeCompleted: round(before.completedUnits),
            beforeTotal: round(before.totalUnits),
            afterCompleted: round(after.completedUnits),
            afterTotal: round(after.totalUnits),
            dTotal: round(after.totalUnits - before.totalUnits),
            dCompleted: round(after.completedUnits - before.completedUnits),
            // ETA = remaining × msPerUnit. Logged so a jump in displayed
            // seconds can be attributed to the rate moving vs. the units.
            msPerUnit: round(msPerUnit),
            remaining: round(remaining),
            etaSec: round((remaining * msPerUnit) / 1000),
            activeCompleted: round(after.active?.completedUnits ?? 0),
            activeTotal: round(after.active?.totalUnits ?? 0),
            activeApplying: round(after.active?.phaseUnits.applying ?? 0),
        }) + "\n";
    FileLib.write(PATH, buffer, true);
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}

// ── Import trace ──────────────────────────────────────────────────────────
//
// A full per-op record of an import, separate from the ETA-focused progress
// trace above: one JSONL line per meaningful step (phase boundaries, the
// planned diff and each op's input→output, and failures). Toggled via
// `/htsw trace [on|off]`. Purpose: hand the file to an AI for a post-mortem
// of why an import did/didn't change something or where it died.

const IMPORT_TRACE_PATH = "./htsw/import-trace.jsonl";

let importTraceEnabled = false;
let importTraceBuffer = "";
let importTraceStartedAt = 0;

export function setImportTraceEnabled(next: boolean): string {
    importTraceEnabled = next;
    if (importTraceEnabled) {
        importTraceBuffer = "";
        importTraceStartedAt = Date.now();
        FileLib.write(IMPORT_TRACE_PATH, "", true);
    }
    return IMPORT_TRACE_PATH;
}

export function isImportTraceEnabled(): boolean {
    return importTraceEnabled;
}

export function getImportTracePath(): string {
    return IMPORT_TRACE_PATH;
}

function writeImportTraceLine(record: Record<string, unknown>): void {
    const now = Date.now();
    importTraceBuffer +=
        JSON.stringify({ at: now, tMs: now - importTraceStartedAt, ...record }) + "\n";
    FileLib.write(IMPORT_TRACE_PATH, importTraceBuffer, true);
}

export function traceImportEvent(event: ImportEvent): void {
    if (!importTraceEnabled) return;
    switch (event.kind) {
        case "importableStarted":
            writeImportTraceLine({
                kind: "phase",
                phase: "read",
                importable: `${event.type} ${event.identity}`,
                cached: event.cached !== null,
            });
            return;
        case "importableReactivated":
            writeImportTraceLine({ kind: "phase", phase: "apply", rowIndex: event.rowIndex });
            return;
        case "readStarted":
            writeImportTraceLine({ kind: "read", listPath: event.listPath });
            return;
        case "diffPlanned":
            writeImportTraceLine({ kind: "diffSummary", summary: event.summary });
            for (const op of event.operations) {
                writeImportTraceLine({
                    kind: "op",
                    op: op.op,
                    path: op.path,
                    actionType: op.actionType,
                    fieldsChanged: op.op === "edit" ? op.fieldsChanged : undefined,
                    input:
                        op.op === "edit" || op.op === "delete" ? op.observed : undefined,
                    output: op.op === "edit" || op.op === "add" ? op.desired : undefined,
                });
            }
            return;
        case "operationStarted":
            writeImportTraceLine({
                kind: "opStart",
                op: event.op,
                path: event.path,
                actionType: event.actionType,
            });
            return;
        case "importableFinished":
            writeImportTraceLine({
                kind: event.status === "failed" ? "failure" : "phase",
                phase: "finish",
                status: event.status,
                error: event.error,
            });
            return;
        case "sessionStarted":
        case "sessionFinished":
        case "progress":
        case "setupStep":
        case "nestedReadStarted":
        case "observedSnapshot":
        case "operationCompleted":
        case "listSyncCompleted":
        case "blockActionHeaderApplied":
        case "finalizeSource":
            return;
    }
}
