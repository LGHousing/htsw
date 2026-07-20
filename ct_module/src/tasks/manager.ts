import TaskContext from "./context";
export { isTaskCancelled } from "./cancellation";
import { isTaskCancelled } from "./cancellation";

type TaskCallback<T, A extends unknown[] = unknown[]> = (
    ctx: TaskContext,
    ...args: A
) => Promise<T>;

export class TaskManager {
    private static runningContext: TaskContext | null = null;

    public static run<T, A extends unknown[]>(
        callback: TaskCallback<T, A>,
        ...args: A
    ): Promise<T | undefined> {
        const task = this.tryRun(callback, ...args);
        if (task === null) {
            return Promise.reject(new Error("A task is already running"));
        }
        return task;
    }

    public static tryRun<T, A extends unknown[]>(
        callback: TaskCallback<T, A>,
        ...args: A
    ): Promise<T | undefined> | null {
        if (this.runningContext !== null) return null;
        const ctx = new TaskContext();
        this.runningContext = ctx;
        return this.execute(ctx, callback, args);
    }

    private static async execute<T, A extends unknown[]>(
        ctx: TaskContext,
        callback: TaskCallback<T, A>,
        args: A
    ): Promise<T | undefined> {
        try {
            return await callback(ctx, ...args);
        } catch (err: unknown) {
            if (isTaskCancelled(err)) {
                ChatLib.chat(`&cTask cancelled`);
                return undefined;
            } else {
                throw err;
            }
        } finally {
            if (this.runningContext === ctx) this.runningContext = null;
        }
    }

    public static isBusy(): boolean {
        return this.runningContext !== null;
    }
}
