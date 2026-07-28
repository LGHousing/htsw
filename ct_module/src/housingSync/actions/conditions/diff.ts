import type { Condition } from "htsw/types";

import { conditionOnlyNoteDiffers, conditionsEqual } from "../comparison";
import type {
    ConditionListDiff,
    ConditionListOperation,
    CurrentConditionListEntry,
} from "../diff/types";
import type { ObservedConditionSlot } from "../../observedActions";
import type { ItemDiffContext } from "../diff/itemDiffContext";

export function currentConditionListFromSlots(
    slots: readonly ObservedConditionSlot[]
): CurrentConditionListEntry[] {
    const out: CurrentConditionListEntry[] = [];
    for (let i = 0; i < slots.length; i++) {
        out.push({
            entryId: i,
            condition: slots[i].condition,
        });
    }
    return out;
}

export function baselineConditionListFromConditions(
    conditions: ReadonlyArray<Condition | null>
): CurrentConditionListEntry[] {
    const out: CurrentConditionListEntry[] = [];
    for (let i = 0; i < conditions.length; i++) {
        out.push({
            entryId: i,
            condition: conditions[i],
        });
    }
    return out;
}

function indexOfEqualCondition(
    entries: readonly CurrentConditionListEntry[],
    desired: Condition,
    itemDiff?: ItemDiffContext
): number {
    for (let i = 0; i < entries.length; i++) {
        if (
            !itemDiff?.conditionsDiffer(entries[i].condition, desired) &&
            conditionsEqual(entries[i].condition, desired)
        ) {
            return i;
        }
    }
    return -1;
}

function indexOfNoteOnlyCondition(
    entries: readonly CurrentConditionListEntry[],
    desired: Condition,
    itemDiff?: ItemDiffContext
): number {
    for (let i = 0; i < entries.length; i++) {
        if (
            !itemDiff?.conditionsDiffer(entries[i].condition, desired) &&
            conditionOnlyNoteDiffers(desired, entries[i].condition)
        ) {
            return i;
        }
    }
    return -1;
}

function indexOfConditionType(
    entries: readonly CurrentConditionListEntry[],
    desired: Condition
): number {
    for (let i = 0; i < entries.length; i++) {
        if (entries[i].condition?.type === desired.type) return i;
    }
    return -1;
}

export function diffConditionList(
    current: CurrentConditionListEntry[],
    desired: Condition[],
    itemDiff?: ItemDiffContext
): ConditionListDiff {
    const unmatchedCurrent = [...current];
    const unmatchedDesired = [...desired];
    const operations: ConditionListOperation[] = [];

    // Drop exact matches before pairing the rest.
    for (
        let desiredIndex = unmatchedDesired.length - 1;
        desiredIndex >= 0;
        desiredIndex--
    ) {
        const desiredCondition = unmatchedDesired[desiredIndex];
        const currentIndex = indexOfEqualCondition(
            unmatchedCurrent,
            desiredCondition,
            itemDiff
        );

        if (currentIndex === -1) {
            continue;
        }

        unmatchedCurrent.splice(currentIndex, 1);
        unmatchedDesired.splice(desiredIndex, 1);
    }

    // Pair note-only edits next. Prefer these over later same-type pairings so
    // a note-only edit doesn't get burned on an arbitrary same-type slot
    // while a real note-only candidate gets deleted-then-added.
    for (
        let desiredIndex = unmatchedDesired.length - 1;
        desiredIndex >= 0;
        desiredIndex--
    ) {
        const desiredCondition = unmatchedDesired[desiredIndex];
        const currentIndex = indexOfNoteOnlyCondition(
            unmatchedCurrent,
            desiredCondition,
            itemDiff
        );

        if (currentIndex === -1) {
            continue;
        }

        const [baselineCondition] = unmatchedCurrent.splice(currentIndex, 1);
        const matchedCondition = baselineCondition.condition;
        if (matchedCondition === null) {
            throw new Error("Matched condition entry has no condition");
        }
        unmatchedDesired.splice(desiredIndex, 1);
        operations.push({
            kind: "edit",
            entryId: baselineCondition.entryId,
            baselineCondition: matchedCondition,
            desired: desiredCondition,
            noteOnly: true,
        });
    }

    // Pair same-type edits, then add anything unmatched.
    for (const desiredCondition of unmatchedDesired) {
        const currentIndex = indexOfConditionType(unmatchedCurrent, desiredCondition);

        if (currentIndex === -1) {
            operations.push({ kind: "add", desired: desiredCondition });
            continue;
        }

        const [baselineCondition] = unmatchedCurrent.splice(currentIndex, 1);
        const matchedCondition = baselineCondition.condition;
        if (matchedCondition === null) {
            throw new Error("Matched condition entry has no condition");
        }
        operations.push({
            kind: "edit",
            entryId: baselineCondition.entryId,
            baselineCondition: matchedCondition,
            desired: desiredCondition,
            noteOnly: false,
        });
    }

    // Delete leftover observed entries.
    for (const currentEntry of unmatchedCurrent) {
        operations.push({
            kind: "delete",
            entryId: currentEntry.entryId,
            baselineCondition: currentEntry.condition,
        });
    }

    return { operations };
}
