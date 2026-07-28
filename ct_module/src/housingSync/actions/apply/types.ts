import type { Action } from "htsw/types";

import TaskContext from "../../../tasks/context";
import type { ProgressScope } from "../../syncEvents";
import type { Observed } from "../../observedActions";
import type { ChildAction, ChildActionListDiff } from "../diff/types";
import type { ActionSyncContext } from "../syncContext";

export type PlannedChildActionList = {
    desired: ChildAction[];
    observed: ReadonlyArray<Observed<ChildAction> | null>;
    diff: ChildActionListDiff;
};

export type ApplyChildActionList = (
    ctx: TaskContext,
    plan: PlannedChildActionList,
    options: {
        sync: ActionSyncContext;
        progressScope: ProgressScope;
        listPath: import("../../actionPath").ActionListPath;
    }
) => Promise<void>;

export type ActionListApplyResult = {
    readonly currentSnapshot: ReadonlyArray<Action | Observed | null>;
};
