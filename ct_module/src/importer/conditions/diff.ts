import type { Condition } from "htsw/types";

import { conditionOnlyNoteDiffers, conditionsEqual } from "../compare";
import type {
    ConditionListDiff,
    ConditionListOperation,
    ObservedConditionSlot,
} from "../types";

export { conditionOnlyNoteDiffers as onlyNoteDiffers } from "../compare";

export function diffConditionList(
    observed: ObservedConditionSlot[],
    desired: Condition[]
): ConditionListDiff {
    const unmatchedObserved = [...observed];
    const unmatchedDesired = [...desired];
    const operations: ConditionListOperation[] = [];

    // Pass 1: drop exact matches before pairing same-type edits.
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

    // Pass 2: same-type edits, else adds. `noteOnly` is computed here so the
    // applier can skip opening the editor for note-only diffs.
    for (const desiredCondition of unmatchedDesired) {
        const observedIndex = unmatchedObserved.findIndex(
            (entry) => entry.condition?.type === desiredCondition.type
        );

        if (observedIndex === -1) {
            operations.push({ kind: "add", desired: desiredCondition });
            continue;
        }

        const [observedCondition] = unmatchedObserved.splice(observedIndex, 1);
        operations.push({
            kind: "edit",
            observed: observedCondition,
            desired: desiredCondition,
            noteOnly: conditionOnlyNoteDiffers(
                desiredCondition,
                observedCondition.condition
            ),
        });
    }

    // Pass 3: leftover observed entries are deletes.
    for (const observed of unmatchedObserved) {
        operations.push({ kind: "delete", observed });
    }

    return { operations };
}
