/**
 * promise-polyfill schedules every `.then()` callback via `setTimeout(fn, 0)`.
 * On CT's Rhino host, `setTimeout(0)` round-trips through a Java timer with
 * ~10-50ms minimum latency, so a single `await` costs that much. Importer
 * chains add up to seconds of pure scheduling overhead per `waitForMenu`.
 *
 * Drain synchronously instead: queue callbacks, run them inline. The first
 * callback into an idle queue takes over and drains everything pushed during
 * its own execution before returning. Stack-safe (uses iteration), and JS
 * is single-threaded here so reentrancy isn't a concern.
 *
 * Semantics drift: `await x` now continues on the same JS turn instead of
 * yielding to the event loop. CT events (tick, packetReceived, etc.) still
 * fire on their normal Java threads — only the *intra-promise* callbacks
 * are accelerated. Long synchronous chains can still in theory delay event
 * processing, but every importer await currently waits on an external
 * signal anyway.
 */

const queue: Array<() => void> = [];
let draining = false;

(Promise as unknown as { _immediateFn: (fn: () => void) => void })._immediateFn = function (fn: () => void): void {
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
};
