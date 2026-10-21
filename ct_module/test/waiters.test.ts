import { expect, test, vi } from "vitest";

import type TaskContext from "../src/tasks/context";
import type { TaskWaiter } from "../src/tasks/context";
import { createTaskCancelledError } from "../src/tasks/cancellation";
import type { WaitForPromise } from "../src/tasks/specifics/waitFor";
import { oneOf } from "../src/tasks/waiters";

function pendingWaiter(label: string): {
    waiter: TaskWaiter<void>;
    reject: (error: unknown) => void;
    resolve: () => void;
    cleanup: ReturnType<typeof vi.fn>;
} {
    let reject!: (error: unknown) => void;
    let resolve!: () => void;
    const cleanup = vi.fn();
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
        reject = rejectPromise;
        resolve = resolvePromise;
    }) as WaitForPromise<void>;
    promise.cleanupWaiter = cleanup;

    return {
        waiter: {
            label,
            start: () => promise,
        },
        reject,
        resolve,
        cleanup,
    };
}

test("oneOf preserves cancellation instead of aggregating it as a failure", async () => {
    const opened = pendingWaiter("menu opened");
    const missing = pendingWaiter("missing message");
    const cancellation = createTaskCancelledError();

    const result = oneOf({
        opened: opened.waiter,
        missing: missing.waiter,
    }).start({} as TaskContext);

    opened.reject(cancellation);

    await expect(result).rejects.toBe(cancellation);
    expect(opened.cleanup).toHaveBeenCalledOnce();
    expect(missing.cleanup).toHaveBeenCalledOnce();
});

test.each([true, false])(
    "oneOf preserves an incomplete read when all alternatives fail (read first: %s)",
    async (readFirst) => {
        const { IncompleteReadError } = await import("../src/housingSync/incompleteRead");
        const opened = pendingWaiter("menu opened");
        const missing = pendingWaiter("missing message");
        const failure = new IncompleteReadError("Menu not ready");
        const result = oneOf({ opened: opened.waiter, missing: missing.waiter }).start(
            {} as TaskContext
        );
        if (readFirst) opened.reject(failure);
        missing.reject(new Error("chat timed out"));
        if (!readFirst) opened.reject(failure);
        await expect(result).rejects.toBe(failure);
        expect(failure.message).toMatch(/^HTSW_INCOMPLETE_READ: Menu not ready/);
        expect(failure.message).toContain("opened failed");
        expect(failure.message).toContain("missing: chat timed out");
        expect(opened.cleanup).toHaveBeenCalledOnce();
        expect(missing.cleanup).toHaveBeenCalledOnce();
    }
);

test("oneOf still accepts a successful alternative after an incomplete menu read", async () => {
    const { IncompleteReadError } = await import("../src/housingSync/incompleteRead");
    const opened = pendingWaiter("menu opened");
    const missing = pendingWaiter("missing message");
    const failure = new IncompleteReadError("Menu not ready");
    const result = oneOf({ opened: opened.waiter, missing: missing.waiter }).start(
        {} as TaskContext
    );
    opened.reject(failure);
    missing.resolve();
    await expect(result).resolves.toBe("missing");
    expect(failure.message).toBe("HTSW_INCOMPLETE_READ: Menu not ready");
});
