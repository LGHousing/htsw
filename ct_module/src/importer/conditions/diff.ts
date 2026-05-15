import type { Condition } from "htsw/types";

import { conditionOnlyNoteDiffers, conditionsEqual } from "../fields/compare";
import type {
    ConditionListDiff,
    ConditionListOperation,
    ObservedConditionSlot,
} from "../types";

export { conditionOnlyNoteDiffers as onlyNoteDiffers } from "../fields/compare";

export function diffConditionList(
    observed: ObservedConditionSlot[],
    desired: Condition[]
): ConditionListDiff {
    const unmatchedObserved = [...observed];
    const unmatchedDesired = [...desired];
    const operations: ConditionListOperation[] = [];

    // Pass 1: drop exact matches before pairing the rest.
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

    // Pass 2: note-only pairs. Prefer these over later same-type pairings so
    // a note-only edit doesn't get burned on an arbitrary same-type slot
    // while a real note-only candidate gets deleted-then-added.
    for (
        let desiredIndex = unmatchedDesired.length - 1;
        desiredIndex >= 0;
        desiredIndex--
    ) {
        const desiredCondition = unmatchedDesired[desiredIndex];
        const observedIndex = unmatchedObserved.findIndex((entry) =>
            conditionOnlyNoteDiffers(desiredCondition, entry.condition)
        );

        if (observedIndex === -1) {
            continue;
        }

        const [observedCondition] = unmatchedObserved.splice(observedIndex, 1);
        unmatchedDesired.splice(desiredIndex, 1);
        operations.push({
            kind: "edit",
            observed: observedCondition,
            desired: desiredCondition,
            noteOnly: true,
        });
    }

    // Pass 3: same-type edits, else adds.
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
            noteOnly: false,
        });
    }

    // Pass 4: leftover observed entries are deletes.
    for (const observed of unmatchedObserved) {
        operations.push({ kind: "delete", observed });
    }

    return { operations };
}
