import { TaskManager } from "../tasks/manager";
import type TaskContext from "../tasks/context";
import { traceError, traceRecord } from "../housingSync/trace/taskTrace";
import { runHousingSyncTask } from "../housingSync/taskRunner";
import {
    resolveExportDestination,
    type ExportDestination,
} from "./exportDestination";

export function runExportWithDestination(
    explicitPath: string | undefined,
    task: (ctx: TaskContext, destination: ExportDestination) => Promise<void>
): void {
    runExportTask(async (ctx) => {
        await task(ctx, await resolveExportDestination(ctx, explicitPath));
    });
}

function runExportTask(task: (ctx: TaskContext) => Promise<void>): void {
    if (TaskManager.isBusy()) {
        ChatLib.chat("&c[htsw] An export (or another task) is already running - wait for it to finish or cancel it first.");
        return;
    }

    runHousingSyncTask("export", async (ctx) => {
        traceRecord("exportTask", { stage: "start" });
        await task(ctx);
        traceRecord("exportTask", { stage: "success" });
    }).catch((err) => {
        traceError("exportTask", err);
        ChatLib.chat(`&cExport failed: ${err}`);
    });
}
