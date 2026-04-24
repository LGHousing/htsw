import type { Action, Condition } from "htsw/types";

import { ACTION_MAPPINGS } from "../actionMappings";
import { normalizeActionCompare, normalizeConditionCompare } from "../compare";
import { CONDITION_LORE_MAPPINGS } from "../conditionMappings";
import type {
    ActionListDiff,
    ActionListOperation,
    Observed,
    ObservedActionSlot,
} from "../types";

type KnownObservedAction = Omit<ObservedActionSlot, "action"> & {
    action: NonNullable<ObservedActionSlot["action"]>;
};

type DesiredActionEntry = {
    index: number;
    action: Action;
};

type ActionMatchKind = "exact" | "note_only" | "same_type";

type ActionMatch = {
    observed: KnownObservedAction;
    desiredIndex: number;
    desired: Action;
    kind: ActionMatchKind;
    cost: number;
};

type ConditionEntry = {
    index: number;
    condition: Condition;
};

const NOTE_ONLY_COST = 1;

function actionsEqual(
    observed: Action | Observed<Action>,
    desired: Action | Observed<Action>
): boolean {
    return (
        JSON.stringify(normalizeActionCompare(observed)) ===
        JSON.stringify(normalizeActionCompare(desired))
    );
}

function conditionsEqual(
    observed: Condition | Observed<Condition> | null,
    desired: Condition | Observed<Condition> | null
): boolean {
    return (
        JSON.stringify(normalizeConditionCompare(observed)) ===
        JSON.stringify(normalizeConditionCompare(desired))
    );
}

function getFieldValue(value: object, key: string): unknown {
    return (value as { [key: string]: unknown })[key];
}

function fieldDifferenceCount(
    observed: object,
    desired: object,
    props: string[]
): number {
    let cost = 0;

    for (const key of props) {
        if (getFieldValue(observed, key) !== getFieldValue(desired, key)) {
            cost += 1;
        }
    }

    return cost;
}

function stripActionNote(action: Action | Observed<Action>): Action | Observed<Action> {
    const { note: _note, ...withoutNote } = action;
    return withoutNote as Action | Observed<Action>;
}

function onlyNoteDiffers(
    desired: Action,
    current: NonNullable<ObservedActionSlot["action"]>
): boolean {
    return (
        desired.type === current.type &&
        JSON.stringify(normalizeActionCompare(stripActionNote(desired))) ===
            JSON.stringify(normalizeActionCompare(stripActionNote(current))) &&
        desired.note !== current.note
    );
}

function circularMoveDistance(from: number, to: number, listLength: number): number {
    if (listLength <= 1) {
        return 0;
    }

    const directDistance = Math.abs(from - to);
    return Math.min(directDistance, listLength - directDistance);
}

function conditionCost(observed: Condition, desired: Condition): number {
    if (conditionsEqual(observed, desired)) {
        return 0;
    }

    const loreFields = CONDITION_LORE_MAPPINGS[observed.type].loreFields as Record<
        string,
        { prop: string }
    >;
    const mappedProps: string[] = [];
    for (const label in loreFields) {
        mappedProps.push(loreFields[label].prop);
    }

    return (
        fieldDifferenceCount(observed, desired, mappedProps) +
        (observed.inverted === desired.inverted ? 0 : 1) +
        (observed.note === desired.note ? 0 : 1)
    );
}

function conditionListCost(
    observed: Array<Condition | null>,
    desired: Condition[]
): number {
    const unmatchedObserved = observed.map((condition, index) => ({ index, condition }));
    const unmatchedDesired = desired.map((condition, index) => ({ index, condition }));

    for (
        let desiredIndex = unmatchedDesired.length - 1;
        desiredIndex >= 0;
        desiredIndex--
    ) {
        const desiredEntry = unmatchedDesired[desiredIndex];
        const observedIndex = unmatchedObserved.findIndex((entry) =>
            conditionsEqual(entry.condition, desiredEntry.condition)
        );

        if (observedIndex === -1) {
            continue;
        }

        unmatchedObserved.splice(observedIndex, 1);
        unmatchedDesired.splice(desiredIndex, 1);
    }

    let cost = 0;
    for (const entry of unmatchedObserved) {
        if (entry.condition === null) {
            cost += 1;
        }
    }

    const remainingTypes = new Set(unmatchedDesired.map((entry) => entry.condition.type));

    for (const type of remainingTypes) {
        const observedBucket = unmatchedObserved.filter(
            (entry): entry is ConditionEntry =>
                entry.condition !== null && entry.condition.type === type
        );
        const desiredBucket = unmatchedDesired.filter(
            (entry) => entry.condition.type === type
        );

        const candidates: Array<{
            observed: ConditionEntry;
            desired: ConditionEntry;
            cost: number;
        }> = [];

        for (const desiredEntry of desiredBucket) {
            for (const observedEntry of observedBucket) {
                candidates.push({
                    observed: observedEntry,
                    desired: desiredEntry,
                    cost: conditionCost(observedEntry.condition, desiredEntry.condition),
                });
            }
        }

        candidates.sort(
            (a, b) =>
                a.cost - b.cost ||
                a.observed.index - b.observed.index ||
                a.desired.index - b.desired.index
        );

        const usedObserved = new Set<number>();
        const usedDesired = new Set<number>();

        for (const candidate of candidates) {
            if (
                usedObserved.has(candidate.observed.index) ||
                usedDesired.has(candidate.desired.index)
            ) {
                continue;
            }

            usedObserved.add(candidate.observed.index);
            usedDesired.add(candidate.desired.index);
            cost += candidate.cost;
        }
    }

    return cost;
}

function actionCost(
    observed: KnownObservedAction,
    desired: DesiredActionEntry,
    listLength: number
): number {
    if (observed.action.type !== desired.action.type) {
        return Number.POSITIVE_INFINITY;
    }

    if (actionsEqual(observed.action, desired.action)) {
        return 0;
    }

    if (onlyNoteDiffers(desired.action, observed.action)) {
        return NOTE_ONLY_COST;
    }

    const loreFields = ACTION_MAPPINGS[observed.action.type].loreFields as Record<
        string,
        { prop: string; kind: string }
    >;
    const nestedProps: string[] = [];
    const scalarProps: string[] = [];
    for (const label in loreFields) {
        const field = loreFields[label];
        if (field.kind === "nestedList") {
            nestedProps.push(field.prop);
        } else {
            scalarProps.push(field.prop);
        }
    }

    let cost = circularMoveDistance(observed.index, desired.index, listLength);
    cost += fieldDifferenceCount(observed.action, desired.action, scalarProps);
    cost += observed.action.note === desired.action.note ? 0 : 1;

    for (const prop of nestedProps) {
        const observedValue = getFieldValue(observed.action, prop);
        const desiredValue = getFieldValue(desired.action, prop);

        if (!Array.isArray(observedValue) || !Array.isArray(desiredValue)) {
            if (observedValue !== desiredValue) {
                cost += 1;
            }
            continue;
        }

        if (prop === "conditions") {
            cost += conditionListCost(
                observedValue as Array<Condition | null>,
                desiredValue as Condition[]
            );
        } else {
            cost += actionListCost(
                observedValue as Array<Observed<Action> | null>,
                desiredValue as Action[]
            );
        }
    }

    return cost;
}

function matchActions(
    observed: KnownObservedAction[],
    desired: Action[],
    listLength: number
): {
    matches: ActionMatch[];
    unmatchedObserved: KnownObservedAction[];
    unmatchedDesired: DesiredActionEntry[];
} {
    const unmatchedObserved = [...observed];
    const unmatchedDesired = desired.map((action, index) => ({ index, action }));
    const matches: ActionMatch[] = [];

    for (
        let desiredIndex = unmatchedDesired.length - 1;
        desiredIndex >= 0;
        desiredIndex--
    ) {
        const desiredEntry = unmatchedDesired[desiredIndex];
        const observedIndex = unmatchedObserved.findIndex((entry) =>
            actionsEqual(entry.action, desiredEntry.action)
        );
        if (observedIndex === -1) {
            continue;
        }

        const [matchedObserved] = unmatchedObserved.splice(observedIndex, 1);
        unmatchedDesired.splice(desiredIndex, 1);
        matches.push({
            observed: matchedObserved,
            desiredIndex: desiredEntry.index,
            desired: desiredEntry.action,
            kind: "exact",
            cost: 0,
        });
    }

    for (
        let desiredIndex = unmatchedDesired.length - 1;
        desiredIndex >= 0;
        desiredIndex--
    ) {
        const desiredEntry = unmatchedDesired[desiredIndex];
        const observedIndex = unmatchedObserved.findIndex((entry) =>
            onlyNoteDiffers(desiredEntry.action, entry.action)
        );
        if (observedIndex === -1) {
            continue;
        }

        const [matchedObserved] = unmatchedObserved.splice(observedIndex, 1);
        unmatchedDesired.splice(desiredIndex, 1);
        matches.push({
            observed: matchedObserved,
            desiredIndex: desiredEntry.index,
            desired: desiredEntry.action,
            kind: "note_only",
            cost: NOTE_ONLY_COST,
        });
    }

    const remainingTypes = new Set(unmatchedDesired.map((entry) => entry.action.type));
    for (const type of remainingTypes) {
        const observedBucket = unmatchedObserved.filter(
            (entry) => entry.action.type === type
        );
        const desiredBucket = unmatchedDesired.filter(
            (entry) => entry.action.type === type
        );
        if (observedBucket.length === 0 || desiredBucket.length === 0) {
            continue;
        }

        const candidates: Array<{
            observed: KnownObservedAction;
            desired: DesiredActionEntry;
            cost: number;
        }> = [];

        for (const desiredEntry of desiredBucket) {
            for (const observedEntry of observedBucket) {
                candidates.push({
                    observed: observedEntry,
                    desired: desiredEntry,
                    cost: actionCost(observedEntry, desiredEntry, listLength),
                });
            }
        }

        candidates.sort(
            (a, b) =>
                a.cost - b.cost ||
                a.observed.index - b.observed.index ||
                a.desired.index - b.desired.index
        );

        const usedObserved = new Set<KnownObservedAction>();
        const usedDesired = new Set<number>();

        for (const candidate of candidates) {
            if (
                usedObserved.has(candidate.observed) ||
                usedDesired.has(candidate.desired.index)
            ) {
                continue;
            }

            usedObserved.add(candidate.observed);
            usedDesired.add(candidate.desired.index);
            matches.push({
                observed: candidate.observed,
                desiredIndex: candidate.desired.index,
                desired: candidate.desired.action,
                kind: "same_type",
                cost: candidate.cost,
            });
        }

        for (let index = unmatchedObserved.length - 1; index >= 0; index--) {
            if (usedObserved.has(unmatchedObserved[index])) {
                unmatchedObserved.splice(index, 1);
            }
        }

        for (let index = unmatchedDesired.length - 1; index >= 0; index--) {
            if (usedDesired.has(unmatchedDesired[index].index)) {
                unmatchedDesired.splice(index, 1);
            }
        }
    }

    matches.sort((a, b) => a.desiredIndex - b.desiredIndex);

    return { matches, unmatchedObserved, unmatchedDesired };
}

function actionListCost(
    observed: Array<Observed<Action> | null>,
    desired: Action[]
): number {
    const knownObserved = observed
        .map((action, index) => (action === null ? null : { index, action }))
        .filter(
            (
                entry
            ): entry is {
                index: number;
                action: NonNullable<ObservedActionSlot["action"]>;
            } => entry !== null
        )
        .map((entry) => ({
            index: entry.index,
            slotId: -1,
            slot: null as never,
            action: entry.action,
        }));

    const matchResult = matchActions(knownObserved, desired, observed.length);

    let cost = matchResult.matches.reduce((total, match) => total + match.cost, 0);
    cost += observed.filter((entry) => entry === null).length;
    return cost;
}

export function diffActionList(
    readActions: ObservedActionSlot[],
    desired: Action[]
): ActionListDiff {
    const knownObserved = readActions.filter(
        (entry): entry is KnownObservedAction => entry.action !== null
    );
    const unknownObserved = readActions.filter((entry) => entry.action === null);
    const matchResult = matchActions(knownObserved, desired, readActions.length);
    const operations: ActionListOperation[] = [];

    for (const observed of unknownObserved) {
        operations.push({ kind: "delete", observed });
    }

    for (const observed of matchResult.unmatchedObserved) {
        operations.push({ kind: "delete", observed });
    }

    const desiredOrderedMatches = [...matchResult.matches].sort(
        (a, b) => a.desiredIndex - b.desiredIndex
    );
    const observedOrderedMatches = [...matchResult.matches].sort(
        (a, b) => a.observed.index - b.observed.index
    );

    for (let targetIndex = 0; targetIndex < desiredOrderedMatches.length; targetIndex++) {
        const match = desiredOrderedMatches[targetIndex];

        if (observedOrderedMatches[targetIndex] !== match) {
            operations.push({
                kind: "move",
                observed: match.observed,
                toIndex: targetIndex,
                action: match.desired,
            });
        }

        if (!actionsEqual(match.observed.action, match.desired)) {
            operations.push({
                kind: "edit",
                observed: match.observed,
                desired: match.desired,
                noteOnly: match.kind === "note_only",
            });
        }
    }

    for (const unmatched of matchResult.unmatchedDesired) {
        operations.push({
            kind: "add",
            desired: unmatched.action,
            toIndex: unmatched.index,
        });
    }

    return { operations };
}
