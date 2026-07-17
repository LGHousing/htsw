import type { Action } from "htsw/types";

import TaskContext from "../../../tasks/context";
import type { Observed } from "../../observedActions";
import type { ActionListPrereadOptions } from "../plan";

export type ApplyChildActionList = (
    ctx: TaskContext,
    desired: Action[],
    options: ActionListPrereadOptions
) => Promise<void>;

export type ActionListApplyResult = {
    readonly currentSnapshot: ReadonlyArray<Action | Observed<Action> | null>;
};
