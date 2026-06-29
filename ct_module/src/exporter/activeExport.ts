import type TaskContext from "../tasks/context";

let activeExportCtx: TaskContext | null = null;

export function setActiveExportContext(ctx: TaskContext | null): void {
    activeExportCtx = ctx;
}

export function clearActiveExportContext(ctx: TaskContext): void {
    if (activeExportCtx === ctx) activeExportCtx = null;
}

export function cancelActiveExport(): boolean {
    if (activeExportCtx === null) return false;
    activeExportCtx.cancel();
    return true;
}
