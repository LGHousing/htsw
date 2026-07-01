import { TaskManager } from "../tasks/manager";
import type TaskContext from "../tasks/context";
import { isTaskRunning, setTaskRunning } from "../tasks/runningState";
import { resetEventContainers } from "../tasks/specifics/waitFor";
import { traceError, traceRecord } from "../housingSync/trace/taskTrace";
import {
    clearActiveTaskContext,
    setActiveTaskContext,
} from "../tasks/activeTask";
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
    if (isTaskRunning() || TaskManager.hasRunningTasks()) {
        ChatLib.chat("&c[htsw] An export (or another task) is already running - wait for it to finish or cancel it first.");
        return;
    }

    TaskManager.run(async (ctx) => {
        setActiveTaskContext("export", ctx);
        setTaskRunning(true);
        traceRecord("exportTask", { stage: "start" });
        try {
            const purged = resetEventContainers();
            if (purged > 0) {
                ChatLib.chat(`&8[htsw] purged ${purged} leaked event waiter(s) from a prior run.`);
                traceRecord("waiters", { stage: "purged", count: purged });
            }
            await task(ctx);
            traceRecord("exportTask", { stage: "success" });
        } finally {
            clearActiveTaskContext("export", ctx);
            setTaskRunning(false);
        }
    }).catch((err) => {
        setTaskRunning(false);
        traceError("exportTask", err);
        ChatLib.chat(`&cExport failed: ${err}`);
    });
}
