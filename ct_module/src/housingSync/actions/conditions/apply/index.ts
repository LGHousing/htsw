import type { Condition } from "htsw/types";

import TaskContext from "../../../../tasks/context";
import {
    conditionListReadUnits,
    estimateConditionListPhaseUnits,
    phaseUnitsTotal,
} from "../../../progress/costs";
import { currentConditionListFromSlots, diffConditionList } from "../diff";
import { readConditionList } from "../readList";
import { appendConditionsToOpenConditionList } from "./conditionOps";
import { ConditionListApplyRun } from "./run";
import type { ApplyConditionListOptions } from "./types";

export { appendConditionsToOpenConditionList, type ApplyConditionListOptions };

export async function applyConditionList(
    ctx: TaskContext,
    desired: Condition[],
    options: ApplyConditionListOptions
): Promise<void> {
    const phaseUnits = estimateConditionListPhaseUnits(desired, options.baselineCurrent);
    const progress = options.progress;
    progress?.({
        phase: "reading",
        completedUnits: 0,
        totalUnits: phaseUnitsTotal(phaseUnits),
        phaseUnits: phaseUnits,
        sync: { completedUnits: 0, totalUnits: 1, parent: null },
    });
    const observed = await readConditionList(ctx, {
        itemReadMode: "sync",
        canonicalizeItemName: options.canonicalizeItemName,
        itemFieldObservations: options.itemFieldObservations,
        phaseUnits,
        progress,
    });
    phaseUnits.reading = conditionListReadUnits(observed.length);
    progress?.({
        phase: "reading",
        completedUnits: phaseUnits.reading,
        totalUnits: phaseUnitsTotal(phaseUnits),
        phaseUnits: phaseUnits,
        sync: { completedUnits: 1, totalUnits: 1, parent: null },
    });

    const diff = diffConditionList(
        currentConditionListFromSlots(observed),
        desired,
        options.itemDiff
    );
    const run = new ConditionListApplyRun(ctx, observed, diff, options, phaseUnits);
    await run.apply();
}
