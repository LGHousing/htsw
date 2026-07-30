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

test("defers cancellation until the active mutation finishes", async () => {
    let mutationFinished = false;
    let continuedAfterMutation = false;

    await TaskManager.run(async (ctx) => {
        await ctx.finishBeforeCancelling(async () => {
            ctx.cancel();
            ctx.checkCancelled();
            mutationFinished = true;
        });
        continuedAfterMutation = true;
    });

    expect(mutationFinished).toBe(true);
    expect(continuedAfterMutation).toBe(false);
});

test("forced cancellation interrupts an active mutation", async () => {
    let mutationFinished = false;

    await TaskManager.run(async (ctx) => {
        await ctx.finishBeforeCancelling(async () => {
            ctx.forceCancel();
            ctx.checkCancelled();
            mutationFinished = true;
        });
    });

    expect(mutationFinished).toBe(false);
});

test("normal cancellation allows explicit cleanup", async () => {
    let cleanupReachedSafePoint = false;

    await TaskManager.run(async (ctx) => {
        ctx.cancel();
        await ctx.finishCancellationCleanup(async () => {
            ctx.checkCancelled();
            cleanupReachedSafePoint = true;
        });
        ctx.checkCancelled();
    });

    expect(cleanupReachedSafePoint).toBe(true);
});
