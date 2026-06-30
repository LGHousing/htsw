import type { Action } from "htsw/types";

import TaskContext from "../../../tasks/context";
import type { ActionListPrereadOptions } from "../plan";

export type ApplyInnerActionList = (
    ctx: TaskContext,
    desired: Action[],
    options: ActionListPrereadOptions
) => Promise<void>;

export type ActionListApplyResult = {
    readonly currentSnapshot: ReadonlyArray<Action | null>;
};
