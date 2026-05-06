import type { Condition } from "htsw/types";

import { conditionsEqual } from "../compare";
import type { ObservedConditionSlot } from "../types";

export { conditionOnlyNoteDiffers as onlyNoteDiffers } from "../compare";

export type ConditionListDiff = {
    edits: Array<{
        observed: ObservedConditionSlot;
        desired: Condition;
    }>;
    deletes: ObservedConditionSlot[];
    adds: Condition[];
};

export function diffConditionList(
    observed: ObservedConditionSlot[],
    desired: Condition[]
): ConditionListDiff {
    const unmatchedObserved = [...observed];
    const unmatchedDesired = [...desired];
    const edits: ConditionListDiff["edits"] = [];
    const adds: Condition[] = [];

    // Remove exact matches before pairing same-type edits.
    for (
        let desiredIndex = unmatchedDesired.length - 1;
        desiredIndex >= 0;
        desiredIndex--
    ) {
        const desiredCondition = unmatchedDesired[desiredIndex];
        const observedIndex = unmatchedObserved.findIndex((entry) =>
            conditionsEqual(entry.condition, desiredCondition)
        );

        if (observedIndex === -1) {
            continue;
        }

        unmatchedObserved.splice(observedIndex, 1);
        unmatchedDesired.splice(desiredIndex, 1);
    }

    for (const desiredCondition of unmatchedDesired) {
        const observedIndex = unmatchedObserved.findIndex(
            (entry) => entry.condition?.type === desiredCondition.type
        );

        if (observedIndex === -1) {
            adds.push(desiredCondition);
            continue;
        }

        const [observedCondition] = unmatchedObserved.splice(observedIndex, 1);
        edits.push({
            observed: observedCondition,
            desired: desiredCondition,
        });
    }

    return {
        edits,
        deletes: unmatchedObserved,
        adds,
    };
}
