import { cancelActiveTask } from "../../../tasks/activeTask";

export function requestTaskCancellation(): boolean {
    return cancelActiveTask();
}
