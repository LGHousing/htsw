/// <reference types="../../../CTAutocomplete" />

import type { SyncEvent } from "../syncEvents";
import type { TaskProgress } from "../progress/types";
import { currentMsPerUnit } from "../progress/eta";
import { createJsonlTrace } from "../../trace/jsonl";
import { actionTreePathKey } from "../actionPath";

const progressTrace = createJsonlTrace("./htsw/progress-trace.jsonl");
const TICK_INTERVAL_MS = 100;

export type TraceSample = {
    etaSec: number | null;
    phaseEtaSec: number | null;
    msPerUnit: number;
    remaining: number;
    completed: number;
    total: number;
};

let sampler: (() => TraceSample | null) | null = null;
let lastTickAt = 0;

export function setProgressTraceSampler(fn: () => TraceSample | null): void {
    sampler = fn;
}

export function setProgressTraceEnabled(next: boolean): string {
    if (next) {
        lastTickAt = 0;
        return progressTrace.start();
    }
    return progressTrace.stop();
}

export function sampleProgressTraceTick(): void {
    if (!progressTrace.isEnabled() || sampler === null) return;
    const now = Date.now();
    if (now - lastTickAt < TICK_INTERVAL_MS) return;
    lastTickAt = now;
    const s = sampler();
    if (s === null) return;
    progressTrace.write({
        kind: "tick",
        etaSec: s.etaSec === null ? null : round(s.etaSec),
        phaseEtaSec: s.phaseEtaSec === null ? null : round(s.phaseEtaSec),
        msPerUnit: round(s.msPerUnit),
        remaining: round(s.remaining),
        completed: round(s.completed),
        total: round(s.total),
    });
}

export function traceConditionOp(info: {
    opKind: "add" | "edit" | "delete" | "noteOnly";
    conditionType: string;
    units: number;
    invertChanged?: boolean;
    fieldsChanged?: string[];
}): void {
    progressTrace.write({
        kind: "conditionOp",
        opKind: info.opKind,
        conditionType: info.conditionType,
        units: round(info.units),
        invertChanged: info.invertChanged,
        fieldsChanged: info.fieldsChanged,
    });
}

export function getProgressTracePath(): string {
    return progressTrace.path();
}

export function traceProgressEvent(
    event: SyncEvent,
    before: TaskProgress,
    after: TaskProgress
): void {
    if (!progressTrace.isEnabled()) return;
    const scope = event.kind === "progress" ? event.scope.kind : "";
    const path =
        event.kind === "progress" && event.scope.kind === "childList"
            ? actionTreePathKey(event.scope.path)
            : "";
    const msPerUnit = currentMsPerUnit();
    const remaining = Math.max(0, after.totalUnits - after.completedUnits);
    const ev = event as { op?: string; actionType?: string; fieldsChanged?: string[] };
    progressTrace.write({
        kind: event.kind,
        scope,
        path,
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
        msPerUnit: round(msPerUnit),
        remaining: round(remaining),
        etaSec: round((remaining * msPerUnit) / 1000),
        activeCompleted: round(after.active?.completedUnits ?? 0),
        activeTotal: round(after.active?.totalUnits ?? 0),
        activeApplying: round(after.active?.phaseUnits.applying ?? 0),
    });
}

function round(n: number): number {
    return Math.round(n * 100) / 100;
}
