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
