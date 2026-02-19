import TaskContext from "./context";

export type TaskCancelledError = { __taskCancelled: true; reason: string };

export function isTaskCancelled(err: unknown): err is TaskCancelledError {
    return !!err && typeof err === "object" && (err as any).__taskCancelled === true;
}

type TaskCallback<A extends unknown[] = unknown[]> = (
    ctx: TaskContext,
    ...args: A
) => Promise<void>;

export class TaskManager {
    private static runningContexts: Set<TaskContext> = new Set();

    public static async run<A extends unknown[]>(
        callback: TaskCallback<A>,
        ...args: A
    ): Promise<void> {
        const ctx = new TaskContext();
        this.runningContexts.add(ctx);

        try {
            await callback(ctx, ...args);
        } catch (err: any) {
            if (isTaskCancelled(err)) {
                ChatLib.chat(`&cTask cancelled`);
            } else {
                throw err;
            }
        } finally {
            this.runningContexts.delete(ctx);
        }
    }

    public static cancelAll() {
        for (const ctx of this.runningContexts) {
            ctx.cancel();
        }
        this.runningContexts.clear();
    }
}

async function exampleTask(ctx: TaskContext, name: string) {
    await ctx.waitFor("message", (message) => {
        ChatLib.chat(`Received message: ${message}`);
        return message.includes("Rfind");
    });
    ctx.displayMessage(`Hello, ${name}!`);
}

register("command", () => {
    TaskManager.run(exampleTask, "World");
}).setName("htswexamplewtf");
