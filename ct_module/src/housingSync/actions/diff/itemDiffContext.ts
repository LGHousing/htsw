import type { Action, Condition } from "htsw/types";

import type { Observed } from "../../observedActions";
import type { CanonicalItemField } from "../../items/fieldContent";

export type ItemDiffContext = {
    hasActionList(actions: readonly Action[]): boolean;
    actionsDiffer(observed: Action | Observed, desired: Action): boolean;
    conditionsDiffer(observed: Condition | null, desired: Condition): boolean;
    fieldContent?: (
        owner: Action | Condition,
        property: string
    ) => CanonicalItemField | undefined;
};
