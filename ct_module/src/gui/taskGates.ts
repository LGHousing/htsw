import { isTaskRunning } from "../tasks/runningState";

export function areTaskWideGatesActive(): boolean {
    return isTaskRunning();
}
