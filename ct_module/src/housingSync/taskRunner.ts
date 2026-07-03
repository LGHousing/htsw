import { TaskManager } from "../tasks/manager";
import type TaskContext from "../tasks/context";
import { setTaskRunning } from "../tasks/runningState";
import { resetEventContainers } from "../tasks/specifics/waitFor";
import {
    clearActiveTaskContext,
    setActiveTaskContext,
    type ActiveTaskKind,
} from "../tasks/activeTask";
import { resetStepGate } from "./stepGate";

// The one place that owns per-run task bookkeeping: active-context
// registration (Cancel button), the running flag, the Pause/Step gate reset,
// and purging event waiters leaked by a prior run. Every housing-menu task
// (import, export, deep read) must start through here — the pause bug
// happened because each starter hand-rolled this list and drifted.
//
// Resolves with the task's result, or undefined when the task was cancelled
// (TaskManager swallows cancellation), so callers skip completion handling
// by checking for undefined. Non-cancellation errors reject as usual.
export async function runHousingSyncTask<T>(
    kind: ActiveTaskKind,
    task: (ctx: TaskContext) => Promise<T>
): Promise<T | undefined> {
    let result: T | undefined;
    await TaskManager.run(async (ctx) => {
        setActiveTaskContext(kind, ctx);
        setTaskRunning(true);
        resetStepGate();
        try {
            // Purge waiters left over from a prior run. Nothing legit is
            // waiting at a task boundary, so survivors are leaks; a non-zero
            // count is a canary that one slipped through the cleanup paths.
            const purged = resetEventContainers();
            if (purged > 0) {
                ChatLib.chat(`&8[htsw] purged ${purged} leaked event waiter(s) from a prior run.`);
            }
            result = await task(ctx);
        } finally {
            clearActiveTaskContext(kind, ctx);
            setTaskRunning(false);
        }
    });
    return result;
}
