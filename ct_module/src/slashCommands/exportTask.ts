import { isTaskCancelled, TaskManager } from "../tasks/manager";
import type TaskContext from "../tasks/context";
import { traceError, traceRecord } from "../housingSync/trace/taskTrace";
import { runHousingSyncTask } from "../housingSync/taskRunner";
import {
    resolveExportDestination,
    type ExportDestination,
} from "./exportDestination";
import { writeTaskFailureLog } from "../runtimeDebug/importFailureLog";

export function runExportWithDestination(
    explicitPath: string | undefined,
    task: (ctx: TaskContext, destination: ExportDestination) => Promise<void>
): void {
    let sourcePath = "";
    runExportTask(async (ctx) => {
        const destination = await resolveExportDestination(ctx, explicitPath);
        sourcePath = destination.importJsonPath;
        await task(ctx, destination);
    }, () => sourcePath);
}

function runExportTask(
    task: (ctx: TaskContext) => Promise<void>,
    sourcePath: () => string = () => ""
): void {
    if (TaskManager.isBusy()) {
        ChatLib.chat("&c[htsw] An export (or another task) is already running - wait for it to finish or cancel it first.");
        return;
    }

    runHousingSyncTask("export", async (ctx) => {
        traceRecord("exportTask", { stage: "start" });
        await task(ctx);
        traceRecord("exportTask", { stage: "success" });
    }).catch((err: unknown) => {
        if (!isTaskCancelled(err)) {
            writeTaskFailureLog(
                { phase: "export", sourcePath: sourcePath(), housingUuid: "" },
                err
            );
        }
        traceError("exportTask", err);
        ChatLib.chat(`&cExport failed: ${String(err)}`);
    });
}
