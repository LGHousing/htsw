import TaskContext from "../../../../tasks/context";
import { conditionListDiffApplyUnits } from "../../../progress/costs";
import { appendConditionsToOpenConditionList } from "./conditionOps";
import { ConditionListApplyRun } from "./run";
import type { ApplyPlannedConditionListOptions } from "./types";
import type { ConditionListDiff } from "../../diff/types";

export {
    appendConditionsToOpenConditionList,
    type ApplyPlannedConditionListOptions,
};

export async function applyPlannedConditionList(
    ctx: TaskContext,
    observedCount: number,
    diff: ConditionListDiff,
    options: ApplyPlannedConditionListOptions
): Promise<void> {
    const phaseUnits = {
        setup: 0,
        reading: 0,
        hydrating: 0,
        applying: conditionListDiffApplyUnits(diff),
    };
    const run = new ConditionListApplyRun(
        ctx,
        observedCount,
        diff,
        options,
        phaseUnits
    );
    await run.apply();
}
