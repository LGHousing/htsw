/// <reference types="../../../CTAutocomplete" />

import type { ImportEvent } from "../importEvents";
import { createJsonlTrace } from "../../trace/jsonl";
import { recordImportDiagnostic } from "../../diagnostics/importDiagnosticsBuffer";

const importTrace = createJsonlTrace("./htsw/import-trace.jsonl");

export function setImportTraceEnabled(next: boolean): string {
    return next ? importTrace.start() : importTrace.stop();
}

export function getImportTracePath(): string {
    return importTrace.path();
}

export function isImportTraceEnabled(): boolean {
    return importTrace.isEnabled();
}

/**
 * One free-form breadcrumb in the import trace — the single home for the
 * developer notes (paginate scans, swallowed ack timeouts, read stacks) that
 * only matter while diagnosing an import. Written only when tracing is on
 * (`/htsw trace on` or a test run), so it costs nothing otherwise. Callers
 * passing an expensive `message` (a menu scan, a stack dump) must guard it with
 * `isImportTraceEnabled()`.
 */
export function traceNote(category: string, message: string): void {
    recordImportDiagnostic("note", { category, message });
    if (!importTrace.isEnabled()) return;
    importTrace.write({ kind: "note", category, message });
}

export function traceMenuWait(
    stage: "start" | "openWindow" | "windowItems" | "ready" | "failure",
    details: Record<string, unknown>
): void {
    recordImportDiagnostic("menuWait", { stage, ...details });
    if (!importTrace.isEnabled()) return;
    importTrace.write({ kind: "menuWait", stage, ...details });
}

export function traceImportEvent(event: ImportEvent): void {
    recordImportDiagnostic("importEvent", {
        event: event.kind,
        key: "key" in event ? event.key : undefined,
        status: "status" in event ? event.status : undefined,
        error: "error" in event ? event.error : undefined,
        path: "path" in event ? event.path : undefined,
    });
    if (!importTrace.isEnabled()) return;
    switch (event.kind) {
        case "importableStarted":
            importTrace.write({
                kind: "phase",
                phase: "read",
                importable: `${event.type} ${event.identity}`,
                cached: event.cached !== null,
            });
            return;
        case "importableReactivated":
            importTrace.write({ kind: "phase", phase: "apply", rowIndex: event.rowIndex });
            return;
        case "readStarted":
            importTrace.write({ kind: "read", listPath: event.listPath });
            return;
        case "diffPlanned":
            importTrace.write({ kind: "diffSummary", summary: event.summary });
            for (const op of event.operations) {
                importTrace.write({
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
            importTrace.write({
                kind: "opStart",
                op: event.op,
                path: event.path,
                actionType: event.actionType,
            });
            return;
        case "importableFinished":
            importTrace.write({
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
