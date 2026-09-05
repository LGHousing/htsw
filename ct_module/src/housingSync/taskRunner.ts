import { TaskManager } from "../tasks/manager";
import { isTaskCancelled } from "../tasks/cancellation";
import {
    beginBridgeRun,
    emitBridgeEvent,
    finishBridgeRun,
    rejectBridgeRun,
} from "../bridge/status";
import type { HtswBridgeEventType, HtswOperation } from "../bridge/types";
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
    task: (ctx: TaskContext) => Promise<T>,
    bridge?: {
        operation?: HtswOperation;
        diagnostic?: HtswBridgeEventType;
        disabled?: boolean;
    }
): Promise<T | undefined> {
    const operation = bridge?.operation ?? (kind === "queue" ? "import" : kind);
    if (TaskManager.isBusy() && !bridge?.disabled)
        rejectBridgeRun(operation, "busy", bridge?.diagnostic);
    return TaskManager.run(async (ctx) => {
        if (!bridge?.disabled)
            beginBridgeRun(operation, kind === "queue" ? "queue" : "task");
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
            if (kind !== "queue" && !bridge?.disabled)
                finishBridgeRun(ctx.isCancelled() ? "cancelled" : "completed");
            resetRuntimeDebugRecords();
            return result;
        } catch (error) {
            if (kind !== "queue" && !bridge?.disabled) {
                const status = isTaskCancelled(error) ? "cancelled" : "failed";
                const reason = error instanceof Error ? error.message : String(error);
                if (bridge?.diagnostic !== undefined)
                    emitBridgeEvent(bridge.diagnostic, { status, reason });
                finishBridgeRun(status, { reason });
            }
            throw error;
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
