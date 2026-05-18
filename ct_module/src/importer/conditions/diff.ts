import type { Condition } from "htsw/types";

import { conditionOnlyNoteDiffers, conditionsEqual } from "../fields/compare";
import type {
    ConditionListDiff,
    ConditionListOperation,
    CurrentConditionListEntry,
    ObservedConditionSlot,
} from "../types";

export { conditionOnlyNoteDiffers as onlyNoteDiffers } from "../fields/compare";

export function currentConditionListFromSlots(
    slots: readonly ObservedConditionSlot[]
): CurrentConditionListEntry[] {
    const out: CurrentConditionListEntry[] = [];
    for (let i = 0; i < slots.length; i++) {
        out.push({
            entryId: i,
            index: slots[i].index,
            condition: slots[i].condition,
        });
    }
    return out;
}

export function currentConditionListFromConditions(
    conditions: ReadonlyArray<Condition | null>
): CurrentConditionListEntry[] {
    const out: CurrentConditionListEntry[] = [];
    for (let i = 0; i < conditions.length; i++) {
        out.push({
            entryId: i,
            index: i,
            condition: conditions[i],
        });
    }
    return out;
}

function indexOfEqualCondition(
    entries: readonly CurrentConditionListEntry[],
    desired: Condition
): number {
    for (let i = 0; i < entries.length; i++) {
        if (conditionsEqual(entries[i].condition, desired)) return i;
    }
    return -1;
}

function indexOfNoteOnlyCondition(
    entries: readonly CurrentConditionListEntry[],
    desired: Condition
): number {
    for (let i = 0; i < entries.length; i++) {
        if (conditionOnlyNoteDiffers(desired, entries[i].condition)) return i;
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
    desired: Condition[]
): ConditionListDiff {
    const unmatchedCurrent = [...current];
    const unmatchedDesired = [...desired];
    const operations: ConditionListOperation[] = [];

    // Pass 1: drop exact matches before pairing the rest.
    for (
        let desiredIndex = unmatchedDesired.length - 1;
        desiredIndex >= 0;
        desiredIndex--
    ) {
        const desiredCondition = unmatchedDesired[desiredIndex];
        const currentIndex = indexOfEqualCondition(unmatchedCurrent, desiredCondition);

        if (currentIndex === -1) {
            continue;
        }

        unmatchedCurrent.splice(currentIndex, 1);
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
        const currentIndex = indexOfNoteOnlyCondition(
            unmatchedCurrent,
            desiredCondition
        );

        if (currentIndex === -1) {
            continue;
        }

        const [currentCondition] = unmatchedCurrent.splice(currentIndex, 1);
        if (currentCondition.condition === null) {
            continue;
        }
        unmatchedDesired.splice(desiredIndex, 1);
        operations.push({
            kind: "edit",
            entryId: currentCondition.entryId,
            currentCondition: currentCondition.condition,
            desired: desiredCondition,
            noteOnly: true,
        });
    }

    // Pass 3: same-type edits, else adds.
    for (const desiredCondition of unmatchedDesired) {
        const currentIndex = indexOfConditionType(unmatchedCurrent, desiredCondition);

        if (currentIndex === -1) {
            operations.push({ kind: "add", desired: desiredCondition });
            continue;
        }

        const [currentCondition] = unmatchedCurrent.splice(currentIndex, 1);
        if (currentCondition.condition === null) {
            operations.push({ kind: "add", desired: desiredCondition });
            continue;
        }
        operations.push({
            kind: "edit",
            entryId: currentCondition.entryId,
            currentCondition: currentCondition.condition,
            desired: desiredCondition,
            noteOnly: false,
        });
    }

    // Pass 4: leftover observed entries are deletes.
    for (const currentEntry of unmatchedCurrent) {
        operations.push({
            kind: "delete",
            entryId: currentEntry.entryId,
            currentCondition: currentEntry.condition,
        });
    }

    return { operations };
}
