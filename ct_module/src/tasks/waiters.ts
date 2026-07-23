import type TaskContext from "./context";
import type { TaskWaiter } from "./context";
import type { WaitForPromise } from "./specifics/waitFor";
import { isTaskCancelled } from "./cancellation";

type AnyWaiter = TaskWaiter<unknown>;
type WaiterKey<T> = Extract<keyof T, string>;
type WaiterResults<T extends Record<string, AnyWaiter>> = {
    [K in keyof T]: T[K] extends TaskWaiter<infer R> ? R : never;
};

function cleanupWaiters(waiters: ReadonlyArray<WaitForPromise<unknown>>): void {
    for (let i = 0; i < waiters.length; i++) {
        waiters[i].cleanupWaiter?.();
    }
}

function waiterLabel(
    prefix: string,
    waiters: Record<string, AnyWaiter>
): string {
    const labels: string[] = [];
    for (const key in waiters) {
        labels.push(`${key}=${waiters[key].label}`);
    }
    return `${prefix} ${labels.join(", ")}`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function allOf<T extends Record<string, AnyWaiter>>(
    waitersByName: T,
    label: string = waiterLabel("Waiting for all of", waitersByName)
): TaskWaiter<WaiterResults<T>> {
    return {
        label,
        start(ctx: TaskContext): WaitForPromise<WaiterResults<T>> {
            const waiters: WaitForPromise<unknown>[] = [];
            const promise = (async (): Promise<WaiterResults<T>> => {
                const result: Partial<WaiterResults<T>> = {};
                const pending: Promise<void>[] = [];
                try {
                    for (const key in waitersByName) {
                        const waiter = waitersByName[key].start(ctx);
                        waiters.push(waiter);
                        pending.push(
                            waiter.then((value) => {
                                (result as Record<string, unknown>)[key] = value;
                            })
                        );
                    }
                    await Promise.all(pending);
                    return result as WaiterResults<T>;
                } catch (error) {
                    cleanupWaiters(waiters);
                    throw error;
                }
            })() as WaitForPromise<WaiterResults<T>>;
            promise.cleanupWaiter = () => cleanupWaiters(waiters);
            promise.catch(() => {});
            return promise;
        },
    };
}

export function oneOf<T extends Record<string, AnyWaiter>>(
    waitersByName: T,
    label: string = waiterLabel("Waiting for one of", waitersByName)
): TaskWaiter<WaiterKey<T>> {
    return {
        label,
        start(ctx: TaskContext): WaitForPromise<WaiterKey<T>> {
            const waiters: WaitForPromise<unknown>[] = [];
            const keys = Object.keys(waitersByName) as WaiterKey<T>[];
            let settled = false;
            let remaining = keys.length;
            const failures: string[] = [];

            const promise = new Promise<WaiterKey<T>>((resolve, reject) => {
                if (keys.length === 0) {
                    reject(new Error(`${label}: no waiters were provided`));
                    return;
                }

                const failIfDone = (): void => {
                    if (settled || remaining > 0) return;
                    settled = true;
                    cleanupWaiters(waiters);
                    reject(new Error(`${label}: ${failures.join("; ")}`));
                };

                const handleFailure = (key: WaiterKey<T>, error: unknown): void => {
                    if (settled) return;
                    if (isTaskCancelled(error)) {
                        settled = true;
                        cleanupWaiters(waiters);
                        reject(error);
                        return;
                    }
                    remaining--;
                    failures.push(`${key}: ${errorMessage(error)}`);
                    failIfDone();
                };

                for (let i = 0; i < keys.length; i++) {
                    const key = keys[i];
                    try {
                        const waiter = waitersByName[key].start(ctx);
                        waiters.push(waiter);
                        waiter.then(
                            () => {
                                if (settled) return;
                                settled = true;
                                cleanupWaiters(waiters);
                                resolve(key);
                            },
                            (error: unknown) => handleFailure(key, error)
                        );
                    } catch (error) {
                        handleFailure(key, error);
                    }
                }
            }) as WaitForPromise<WaiterKey<T>>;

            promise.cleanupWaiter = () => {
                settled = true;
                cleanupWaiters(waiters);
            };
            promise.catch(() => {});
            return promise;
        },
    };
}
