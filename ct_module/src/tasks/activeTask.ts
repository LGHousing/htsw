import type TaskContext from "./context";

export type ActiveTaskKind = "import" | "export";

type ActiveTask = {
    kind: ActiveTaskKind;
    ctx: TaskContext;
};

let activeTask: ActiveTask | null = null;

export function setActiveTaskContext(kind: ActiveTaskKind, ctx: TaskContext): void {
    activeTask = { kind, ctx };
}

export function clearActiveTaskContext(kind: ActiveTaskKind, ctx: TaskContext): void {
    if (activeTask !== null && activeTask.kind === kind && activeTask.ctx === ctx) {
        activeTask = null;
    }
}

export function cancelActiveTask(): boolean {
    if (activeTask === null) return false;
    activeTask.ctx.cancel();
    return true;
}

export function getActiveTaskStartedAt(): number | null {
    return activeTask?.ctx.startedAt ?? null;
}

export function getActiveTaskElapsedMs(): number | null {
    return activeTask?.ctx.elapsedMs() ?? null;
}
