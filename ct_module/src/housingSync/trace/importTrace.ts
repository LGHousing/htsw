/// <reference types="../../../CTAutocomplete" />

import type { ImportEvent } from "../importEvents";
import { createJsonlTrace } from "../../trace/jsonl";

const importTrace = createJsonlTrace("./htsw/import-trace.jsonl");

export function setImportTraceEnabled(next: boolean): string {
    return next ? importTrace.start() : importTrace.stop();
}

export function getImportTracePath(): string {
    return importTrace.path();
}

export function traceMenuWait(
    stage: "start" | "openWindow" | "windowItems" | "ready" | "failure",
    details: Record<string, unknown>
): void {
    importTrace.write({ kind: "menuWait", stage, ...details });
}

export function traceImportEvent(event: ImportEvent): void {
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
