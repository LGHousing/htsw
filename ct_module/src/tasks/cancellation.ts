export type TaskCancelledError = Error & {
    __taskCancelled: true;
    reason: string;
};

export function createTaskCancelledError(): TaskCancelledError {
    const error = new Error("Task cancelled") as TaskCancelledError;
    error.__taskCancelled = true;
    error.reason = "Task cancelled";
    return error;
}

export function isTaskCancelled(error: unknown): error is TaskCancelledError {
    return (
        error instanceof Error &&
        (error as { __taskCancelled?: unknown }).__taskCancelled === true
    );
}
