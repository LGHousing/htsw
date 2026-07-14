import { expect, test } from "vitest";

import type TaskContext from "../src/tasks/context";
import { TaskManager } from "../src/tasks/manager";

test("keeps task admission exclusive until cancellation finishes unwinding", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    let context!: TaskContext;

    const first = TaskManager.tryRun(async (ctx) => {
        context = ctx;
        await held;
        ctx.checkCancelled();
    });
    if (first === null) throw new Error("first task was not admitted");

    let secondStarted = false;
    await expect(
        TaskManager.run(async () => {
            secondStarted = true;
        })
    ).rejects.toThrow("A task is already running");
    expect(secondStarted).toBe(false);

    context.cancel();
    expect(TaskManager.isBusy()).toBe(true);
    expect(TaskManager.tryRun(async () => {})).toBeNull();

    release();
    await expect(first).resolves.toBeUndefined();
    expect(TaskManager.isBusy()).toBe(false);
});
