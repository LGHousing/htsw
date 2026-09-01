/// <reference types="../../../CTAutocomplete" />

import type { SyncEvent } from "../syncEvents";
import { createJsonlTrace } from "../../trace/jsonl";
import { recordRuntimeDebug } from "../../runtimeDebug/runtimeDebugBuffer";
import { ActionTreePath } from "../actionPath";

const taskTrace = createJsonlTrace("./htsw/task-trace.jsonl");

export function setTaskTraceEnabled(next: boolean): string {
    return next ? taskTrace.start() : taskTrace.stop();
}

export function getTaskTracePath(): string {
    return taskTrace.path();
}

export function isTaskTraceEnabled(): boolean {
    return taskTrace.isEnabled();
}

/**
 * One free-form breadcrumb in the task trace. This is the single home for
 * developer notes from live menu tasks, including imports and exports. Written
 * only when tracing is on (`/htsw trace on` or a test run), so it costs nothing
 * otherwise. Callers passing an expensive `message` must guard it with
 * `isTaskTraceEnabled()`.
 */
export function traceNote(category: string, message: string): void {
    recordRuntimeDebug("note", { category, message });
    if (!taskTrace.isEnabled()) return;
    taskTrace.write({ kind: "note", category, message });
}

export function traceMenuWait(
    stage:
        | "start"
        | "openWindow"
        | "windowItems"
        | "pollStart"
        | "ready"
        | "timeoutRecovered"
        | "failure",
    details: Record<string, unknown>
): void {
    recordRuntimeDebug("menuWait", { stage, ...details });
    if (!taskTrace.isEnabled()) return;
    taskTrace.write({ kind: "menuWait", stage, ...details });
}

export function traceSyncEvent(event: SyncEvent): void {
    recordRuntimeDebug("syncEvent", {
        event: event.kind,
        key: "key" in event ? event.key : undefined,
        status: "status" in event ? event.status : undefined,
        error: "error" in event ? event.error : undefined,
        path: "path" in event ? tracePath(event.path) : undefined,
    });
    if (!taskTrace.isEnabled()) return;
    switch (event.kind) {
        case "importableStarted":
            taskTrace.write({
                kind: "phase",
                phase: "read",
                importable: `${event.type} ${event.identity}`,
                cached: event.cached !== null,
            });
            return;
        case "importableReactivated":
            taskTrace.write({ kind: "phase", phase: "apply", rowIndex: event.rowIndex });
            return;
        case "readStarted":
            taskTrace.write({
                kind: "read",
                listPath:
                    event.listPath.parts.length === 0
                        ? "actions"
                        : ActionTreePath.key(event.listPath),
            });
            return;
        case "diffPlanned":
            taskTrace.write({ kind: "diffSummary", summary: event.summary });
            for (const op of event.operations) {
                taskTrace.write({
                    kind: "op",
                    op: op.op,
                    path: ActionTreePath.key(op.path),
                    actionType: op.actionType,
                    fieldsChanged: op.op === "edit" ? op.fieldsChanged : undefined,
                    input:
                        op.op === "edit" || op.op === "delete" ? op.observed : undefined,
                    output: op.op === "edit" || op.op === "add" ? op.desired : undefined,
                });
            }
            return;
        case "operationStarted":
            taskTrace.write({
                kind: "opStart",
                op: event.op,
                path: ActionTreePath.key(event.path),
                actionType: event.actionType,
            });
            return;
        case "importableFinished":
            taskTrace.write({
                kind: event.status === "failed" ? "failure" : "phase",
                phase: "finish",
                status: event.status,
                error: event.error,
            });
            return;
        case "sessionStarted":
        case "sessionTotalsLocked":
        case "sessionFinished":
        case "sessionApplicationProgress":
        case "applicationProgress":
        case "progress":
        case "knowledgeSourceUsed":
        case "menuSlotStarted":
        case "setupStep":
        case "childListReadStarted":
        case "observedSnapshot":
        case "actionReadCompleted":
        case "operationCompleted":
        case "listSyncCompleted":
        case "blockActionHeaderApplied":
        case "finalizeSource":
            return;
    }
}

function tracePath(path: ActionTreePath | null | undefined): string | null | undefined {
    return path === null || path === undefined ? path : ActionTreePath.key(path);
}
