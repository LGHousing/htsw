import { runOnMainThread } from "../utils/mainThread";

/**
 * promise-polyfill schedules every `.then()` callback via `setTimeout(fn, 0)`.
 * On CT's Rhino host, `setTimeout(0)` round-trips through a Java timer with
 * ~10-50ms minimum latency, so a single `await` costs that much. Importer
 * chains add up to seconds of pure scheduling overhead per `waitForMenu`.
 *
 * Drain synchronously instead: queue callbacks, run them inline. The first
 * callback into an idle queue takes over and drains everything pushed during
 * its own execution before returning. Stack-safe (uses iteration).
 *
 * Threading: CT triggers run on more than one Java thread (ticks on the main
 * client thread, packets on Netty IO threads, setTimeout on a timer thread).
 * The queue and `draining` flag have no synchronization, and a continuation
 * drained on a non-main thread resumes task code somewhere GUI calls crash —
 * so every off-main caller hops to the main thread first (runOnMainThread),
 * making the queue effectively main-thread-only.
 *
 * Semantics drift: `await x` now continues on the same JS turn instead of
 * yielding to the event loop. Long synchronous chains can still in theory
 * delay event processing, but every importer await currently waits on an
 * external signal anyway.
 */

const queue: Array<() => void> = [];
let draining = false;

function enqueueAndDrain(fn: () => void): void {
    queue.push(fn);
    if (draining) return;
    draining = true;
    try {
        while (queue.length > 0) {
            const next = queue.shift();
            if (next !== undefined) {
                try {
                    next();
                } catch (_e) {
                    // Promise-polyfill swallows callback exceptions itself; if one
                    // escapes here, log via console and keep draining the queue.
                    if (typeof console !== "undefined") {
                        console.warn("Promise drain callback threw:", _e);
                    }
                }
            }
        }
    } finally {
        draining = false;
    }
}

(Promise as unknown as { _immediateFn: (fn: () => void) => void })._immediateFn = function (fn: () => void): void {
    runOnMainThread(() => enqueueAndDrain(fn));
};
