/**
 * Step-debug gate. When `auto` is false, the importer pauses between
 * top-level diff operations until `requestAdvance()` is called. Used by
 * the Import tab's debug "Advance 1 operation" button to walk through
 * the morph animation one op at a time.
 *
 * Top-level only — the gate is invoked from `applyActionListDiffInner`
 * with a `pathPrefix === undefined` guard, so nested CONDITIONAL/RANDOM
 * syncs run uninterrupted (otherwise editing one CONDITIONAL would
 * require N+1 advances for its inner ifActions, which is not what the
 * step button is for).
 */

import TaskContext from "../tasks/context";

let auto = true;
let pendingAdvance = false;

export function getStepAuto(): boolean {
    return auto;
}

export function setStepAuto(value: boolean): void {
    auto = value;
    if (auto) {
        // Switching to auto consumes any pending advance — we're going
        // to run continuously now anyway.
        pendingAdvance = false;
    }
}

export function requestStepAdvance(): void {
    pendingAdvance = true;
}

/**
 * Block until the next op should run. No-op when `auto` is true. When
 * paused, polls every ~50ms for `pendingAdvance` and consumes it on
 * release. Uses `ctx.sleep` so the importer Task respects cancel.
 */
export async function waitIfStepPaused(ctx: TaskContext): Promise<void> {
    if (auto) return;
    while (!auto && !pendingAdvance) {
        await ctx.sleep(50);
    }
    pendingAdvance = false;
}

/** Reset to defaults. Call between import runs so leftover state can't sandbag the next run. */
export function resetStepGate(): void {
    auto = true;
    pendingAdvance = false;
}
