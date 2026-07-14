import { TaskManager } from "../tasks/manager";
import type TaskContext from "../tasks/context";
import { setTaskRunning } from "../tasks/runningState";
import {
    resetEventContainers,
    setPacketCaptureForTask,
} from "../tasks/specifics/waitFor";
import {
    clearActiveTaskContext,
    setActiveTaskContext,
    type ActiveTaskKind,
} from "../tasks/activeTask";
import { resetRuntimeDebugRecords } from "../runtimeDebug/runtimeDebugBuffer";

// Cancellation resolves undefined; other errors still reject.
export async function runHousingSyncTask<T>(
    kind: ActiveTaskKind,
    task: (ctx: TaskContext) => Promise<T>
): Promise<T | undefined> {
    return TaskManager.run(async (ctx) => {
        setActiveTaskContext(kind, ctx);
        setTaskRunning(true);
        try {
            // Purge waiters left over from a prior run. Nothing legit is
            // waiting at a task boundary, so survivors are leaks; a non-zero
            // count is a canary that one slipped through the cleanup paths.
            const purged = resetEventContainers();
            if (purged > 0) {
                ChatLib.chat(`&8[htsw] purged ${purged} leaked event waiter(s) from a prior run.`);
            }
            setPacketCaptureForTask(true);
            const result = await task(ctx);
            resetRuntimeDebugRecords();
            return result;
        } finally {
            setPacketCaptureForTask(false);
            clearActiveTaskContext(kind, ctx);
            setTaskRunning(false);
        }
    });
}
