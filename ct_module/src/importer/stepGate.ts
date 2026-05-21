/**
 * Step-debug gate. When `auto` is false, the importer pauses between
 * top-level diff operations until `requestAdvance()` is called.
 *
 * Top-level only — invoked from `applyActionListDiffInner` with a
 * `pathPrefix === undefined` guard, so nested CONDITIONAL/RANDOM syncs
 * run uninterrupted.
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
        pendingAdvance = false;
    }
}

export function requestStepAdvance(): void {
    pendingAdvance = true;
}

export async function waitIfStepPaused(ctx: TaskContext): Promise<void> {
    if (auto) return;
    while (!auto && !pendingAdvance) {
        await ctx.sleep(50);
    }
    pendingAdvance = false;
}

export function resetStepGate(): void {
    auto = true;
    pendingAdvance = false;
}
