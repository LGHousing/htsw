import type { Condition } from "htsw/types";

import TaskContext from "../../tasks/context";
import { type ItemRegistry } from "../../importables/itemRegistry";
import type { ObservedConditionSlot } from "../types";
import type { ActionListProgressSink } from "../progress/types";
import { diffConditionList } from "./diff";
import { readConditionList } from "./readList";
import {
    applyConditionListDiff,
    logConditionSyncState,
} from "./applyDiff";

export type SyncConditionListOptions = {
    /**
     * Pre-read observed list to use instead of reading from the menu.
     * Mirrors `SyncActionListOptions.observed`.
     */
    observed?: ObservedConditionSlot[];
    itemRegistry?: ItemRegistry;
    /**
     * Last-known cached state of this condition list — typically the
     * observed conditions on the parent CONDITIONAL action.
     */
    cached?: readonly Condition[];
    /**
     * Progress sink that receives one event per condition operation
     * during the apply phase.
     */
    onProgress?: ActionListProgressSink;
};

export type SyncConditionListResult = {
    usedObserved: ObservedConditionSlot[];
};

export async function syncConditionList(
    ctx: TaskContext,
    desired: Condition[],
    options?: SyncConditionListOptions
): Promise<SyncConditionListResult> {
    const observed =
        options?.observed ??
        (await readConditionList(ctx, { itemRegistry: options?.itemRegistry }));
    const diff = diffConditionList(observed, desired);
    logConditionSyncState(ctx, diff);
    const progress = options?.onProgress;

    await applyConditionListDiff(
        ctx,
        observed,
        diff,
        options?.itemRegistry,
        progress
    );
    return { usedObserved: observed };
}
