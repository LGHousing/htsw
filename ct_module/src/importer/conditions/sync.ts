import type { Condition } from "htsw/types";

import TaskContext from "../../tasks/context";
import { type ItemRegistry } from "../../importables/itemRegistry";
import type { ObservedConditionSlot } from "../types";
import type { ProgressHandler } from "../progress/types";
import { currentConditionListFromSlots, diffConditionList } from "./diff";
import { readConditionList } from "./readList";
import {
    applyConditionListDiff,
    logConditionSyncState,
} from "./applyDiff";
import {
    conditionListReadUnits,
    estimateConditionListPhaseUnits,
    phaseUnitsTotal,
} from "../progress/costs";

export type SyncConditionListOptions = {
    observed?: ObservedConditionSlot[];
    itemRegistry?: ItemRegistry;
    baselineCurrent?: ReadonlyArray<Condition | null>;
    progress?: ProgressHandler;
};

export type SyncConditionListResult = {
    usedObserved: ObservedConditionSlot[];
};

export async function syncConditionList(
    ctx: TaskContext,
    desired: Condition[],
    options?: SyncConditionListOptions
): Promise<SyncConditionListResult> {
    const phaseUnits = estimateConditionListPhaseUnits(
        desired,
        options?.baselineCurrent
    );
    const progress = options?.progress;
    progress?.({
        phase: "reading",
        completedUnits: 0,
        totalUnits: phaseUnitsTotal(phaseUnits),
        phaseUnits: phaseUnits,
        sync: { completedUnits: 0, totalUnits: 1, parent: null },
    });
    const observed =
        options?.observed ??
        (await readConditionList(ctx, {
            itemRegistry: options?.itemRegistry,
            phaseUnits,
            progress,
        }));
    phaseUnits.reading = conditionListReadUnits(observed.length);
    progress?.({
        phase: "reading",
        completedUnits: phaseUnits.reading,
        totalUnits: phaseUnitsTotal(phaseUnits),
        phaseUnits: phaseUnits,
        sync: { completedUnits: 1, totalUnits: 1, parent: null },
    });
    const diff = diffConditionList(currentConditionListFromSlots(observed), desired);
    logConditionSyncState(ctx, diff);

    await applyConditionListDiff(
        ctx,
        observed,
        diff,
        options?.itemRegistry,
        progress,
        phaseUnits
    );
    return { usedObserved: observed };
}
