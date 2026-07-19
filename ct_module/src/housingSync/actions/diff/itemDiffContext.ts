import type { Action, Condition } from "htsw/types";

import type { Observed } from "../../observedActions";

export type ItemDiffContext = {
    hasAction(action: Action): boolean;
    hasCondition(condition: Condition): boolean;
    hasActionList(actions: readonly Action[]): boolean;
    actionsDiffer(observed: Action | Observed<Action>, desired: Action): boolean;
    conditionsDiffer(observed: Condition | null, desired: Condition): boolean;
};
