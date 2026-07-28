import type { Action, Condition } from "htsw/types";

import type { Observed } from "../../observedActions";

export type ItemDiffContext = {
    hasActionList(actions: readonly Action[]): boolean;
    actionsDiffer(observed: Action | Observed, desired: Action): boolean;
    conditionsDiffer(observed: Condition | null, desired: Condition): boolean;
    fieldWarnings?(observed: Action | Condition, desired: Action | Condition): string[];
    warningDetails?(): string[];
};
