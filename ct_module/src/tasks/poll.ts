import TaskContext from "./context";

/**
 * Poll `predicate` once per client tick for up to `maxTicks`, resolving true
 * as soon as it holds — for `stableTicks` consecutive ticks when requested
 * (some inventory reads flicker for a tick while packets land).
 *
 * This must stay a finite for-loop, not a `while (!match) await <packet>`
 * wrapped in a timeout: a timed-out packet-event wait leaks a waiter that
 * re-registers itself on every future packet. Polling also means a missing
 * server ack can't hang the task. Every tick-poll in the importer should go
 * through here so that invariant lives in one place.
 */
export async function pollTicks(
    ctx: TaskContext,
    maxTicks: number,
    predicate: () => boolean,
    opts?: { stableTicks?: number }
): Promise<boolean> {
    const needed = opts?.stableTicks ?? 1;
    let stable = 0;
    for (let i = 0; i < maxTicks; i++) {
        if (predicate()) {
            stable++;
            if (stable >= needed) return true;
        } else {
            stable = 0;
        }
        await ctx.waitFor("tick");
    }
    return predicate();
}
