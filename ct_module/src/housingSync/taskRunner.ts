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
import {
    recordRuntimeDebug,
    resetRuntimeDebugRecords,
} from "../runtimeDebug/runtimeDebugBuffer";

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
                recordRuntimeDebug("purgedWaiters", { count: purged });
            }
            setPacketCaptureForTask(true);
            const result = await task(ctx);
            resetRuntimeDebugRecords();
            return result;
        } finally {
            const deferredChat = ctx.abandonChatPrompt();
            if (deferredChat !== null && deferredChat > 0) {
                ChatLib.chat(
                    `&c[htsw] ${deferredChat === 1 ? "Your chat message was" : `${deferredChat} chat messages were`} blocked by Housing's value prompt and could not be resent because the task stopped.`
                );
                ChatLib.chat(
                    "&7[htsw] If a Housing value prompt is still open, run &f/chatinput cancel&7."
                );
            }
            setPacketCaptureForTask(false);
            clearActiveTaskContext(kind, ctx);
            setTaskRunning(false);
        }
    });
}
