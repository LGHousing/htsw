import { expect, test, vi } from "vitest";

import type TaskContext from "../src/tasks/context";
import type { TaskWaiter } from "../src/tasks/context";
import { createTaskCancelledError } from "../src/tasks/cancellation";
import type { WaitForPromise } from "../src/tasks/specifics/waitFor";
import { oneOf } from "../src/tasks/waiters";

function pendingWaiter(label: string): {
    waiter: TaskWaiter<void>;
    reject: (error: unknown) => void;
    cleanup: ReturnType<typeof vi.fn>;
} {
    let reject!: (error: unknown) => void;
    const cleanup = vi.fn();
    const promise = new Promise<void>((_resolve, rejectPromise) => {
        reject = rejectPromise;
    }) as WaitForPromise<void>;
    promise.cleanupWaiter = cleanup;

    return {
        waiter: {
            label,
            start: () => promise,
        },
        reject,
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
