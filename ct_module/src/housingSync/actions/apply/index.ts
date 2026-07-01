import type { Action } from "htsw/types";

import TaskContext from "../../../tasks/context";
import type { ActionListApplyResult } from "./types";
import {
    prereadActionList,
    type ActionListApplyOptions,
    type ActionListPlan,
    type ActionListPrereadOptions,
} from "../plan";
import { appendActionsToOpenActionList } from "./actionOps";
import {
    ActionListApplyRun,
    actionListApplyResultFromError,
} from "./run";

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
    return run.apply(applyChildActionList);
}

async function applyChildActionList(
    ctx: TaskContext,
    desired: Action[],
    options: ActionListPrereadOptions
): Promise<void> {
    const plan = await prereadActionList(ctx, desired, options);
    await applyActionListPlan(ctx, plan, options);
}
