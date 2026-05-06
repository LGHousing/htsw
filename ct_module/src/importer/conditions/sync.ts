import type { Condition } from "htsw/types";

import TaskContext from "../../tasks/context";
import { type ItemRegistry } from "../../importables/itemRegistry";
import type { ObservedConditionSlot } from "../types";
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

    await applyConditionListDiff(ctx, observed, diff, options?.itemRegistry);
    return { usedObserved: observed };
}
