import TaskContext from "../../../tasks/context";
import type { ActionListApplyResult } from "./types";
import {
    type ActionListApplyOptions,
    type ActionListPlan,
} from "../plan";
import { appendActionsToOpenActionList } from "./actionOps";
import { ActionListApplyRun, actionListApplyResultFromError } from "./run";
import type { ApplyChildActionList, PlannedChildActionList } from "./types";
import { childActionListDiffApplyUnits } from "../../progress/costs";

export {
    actionListApplyResultFromError,
    appendActionsToOpenActionList,
    type ActionListApplyResult,
};

export async function applyActionListPlan(
    ctx: TaskContext,
    plan: ActionListPlan,
    options: ActionListApplyOptions
): Promise<ActionListApplyResult> {
    const progressScope = options.progressScope ?? { kind: "topLevel" as const };
    const run = new ActionListApplyRun(ctx, plan, options, progressScope);
    return run.apply(applyPlannedChildActionList);
}

const rejectNestedChildActionList: ApplyChildActionList = async () => {
    throw new Error("An action child list cannot contain another action container.");
};

async function applyPlannedChildActionList(
    ctx: TaskContext,
    childPlan: PlannedChildActionList,
    options: Parameters<ApplyChildActionList>[2]
): Promise<void> {
    const plan: ActionListPlan = {
        desired: childPlan.desired,
        observed: childPlan.observed.map((action, index) => ({
            index,
            action,
            hydrated: true,
            truncatedFields: [],
        })),
        diff: childPlan.diff,
        phaseUnits: {
            setup: 0,
            reading: 0,
            hydrating: 0,
            applying: childActionListDiffApplyUnits(childPlan.diff),
        },
    };
    const run = new ActionListApplyRun(ctx, plan, options, options.progressScope);
    await run.apply(rejectNestedChildActionList);
}
