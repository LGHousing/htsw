import type { Action } from "htsw/types";

import TaskContext from "../../../tasks/context";
import type { ActionListApplyResult } from "./types";
import {
    createKnownActionListPlan,
    type ActionListApplyOptions,
    type ActionListPlan,
    type ActionListPrereadOptions,
} from "../plan";
import { appendActionsToOpenActionList } from "./actionOps";
import { ActionListApplyRun, actionListApplyResultFromError } from "./run";
import { conflictIdentifier } from "../../../importables/import/conflictResolution";

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
    if (
        plan.conflictTarget !== undefined &&
        options.sync.skippedConflicts?.has(conflictIdentifier(plan.conflictTarget))
    ) {
        return { currentSnapshot: plan.observed.map((entry) => entry.action) };
    }
    const progressScope = options.progressScope ?? { kind: "topLevel" as const };
    const run = new ActionListApplyRun(ctx, plan, options, progressScope);
    return run.apply(applyChildActionList);
}

async function applyChildActionList(
    ctx: TaskContext,
    desired: Action[],
    options: ActionListPrereadOptions
): Promise<void> {
    const plan = createKnownActionListPlan(
        desired,
        options.baselineCurrent ?? [],
        options
    );
    await applyActionListPlan(ctx, plan, options);
}
