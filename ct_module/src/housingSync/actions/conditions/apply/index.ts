import type { Condition } from "htsw/types";

import TaskContext from "../../../../tasks/context";
import {
    estimateConditionListPhaseUnits,
} from "../../../progress/costs";
import { baselineConditionListFromConditions, diffConditionList } from "../diff";
import { appendConditionsToOpenConditionList } from "./conditionOps";
import { ConditionListApplyRun } from "./run";
import type { ApplyConditionListOptions } from "./types";

export { appendConditionsToOpenConditionList, type ApplyConditionListOptions };

export async function applyConditionList(
    ctx: TaskContext,
    desired: Condition[],
    options: ApplyConditionListOptions
): Promise<void> {
    const current = options.baselineCurrent ?? [];
    const phaseUnits = estimateConditionListPhaseUnits(desired, current);
    phaseUnits.reading = 0;
    phaseUnits.hydrating = 0;
    const diff = diffConditionList(
        baselineConditionListFromConditions(current),
        desired,
        options.itemDiff
    );
    const run = new ConditionListApplyRun(
        ctx,
        current.length,
        diff,
        options,
        phaseUnits
    );
    await run.apply();
}
