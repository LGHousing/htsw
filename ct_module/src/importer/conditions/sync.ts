import type { Condition } from "htsw/types";

import TaskContext from "../../tasks/context";
import { type ItemRegistry } from "../../importables/itemRegistry";
import type { ObservedConditionSlot } from "../types";
import type { ActionListProgressHandler } from "../progress/types";
import { currentConditionListFromSlots, diffConditionList } from "./diff";
import { readConditionList } from "./readList";
import {
    applyConditionListDiff,
    logConditionSyncState,
} from "./applyDiff";
import {
    conditionListReadUnits,
    estimateConditionListPhaseUnits,
    phaseUnitsFromParts,
} from "../progress/costs";

export type SyncConditionListOptions = {
    observed?: ObservedConditionSlot[];
    itemRegistry?: ItemRegistry;
    baselineCurrent?: ReadonlyArray<Condition | null>;
    onProgress?: ActionListProgressHandler;
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
    const progress = options?.onProgress;
    progress?.({
        phase: "reading",
        phaseLabel: "reading conditions",
        unitCompleted: 0,
        unitTotal: 1,
        completedUnits: 0,
        totalUnits: phaseUnits.total,
        phaseUnits: phaseUnitsFromParts(phaseUnits),
    });
    const observed =
        options?.observed ??
        (await readConditionList(ctx, {
            itemRegistry: options?.itemRegistry,
            phaseUnits,
            onProgress: progress,
        }));
    const readUnits = conditionListReadUnits(observed.length);
    if (readUnits > phaseUnits.readPart) {
        phaseUnits.readPart = readUnits;
        phaseUnits.total =
            phaseUnits.readPart + phaseUnits.hydratePart + phaseUnits.applyPart;
    }
    progress?.({
        phase: "reading",
        phaseLabel: "read conditions",
        unitCompleted: 1,
        unitTotal: 1,
        completedUnits: phaseUnits.readPart,
        totalUnits: phaseUnits.total,
        phaseUnits: phaseUnitsFromParts(phaseUnits),
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
