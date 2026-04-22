import type { Action, Condition } from "htsw/types";

import { getNestedListFields } from "../actionMappings";
import { normalizeForImporterCompare } from "../compare";
import type { ActionListDiff, ActionListOperation, ObservedAction } from "./types";

type MatchableAction = Pick<ObservedAction, "index" | "type" | "action">;

type DesiredActionEntry = {
    index: number;
    action: Action;
};

type ActionMatchKind = "exact" | "note_only" | "same_type";

type ActionMatch<TObserved extends MatchableAction = ObservedAction> = {
    observed: TObserved;
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

function actionsEqual(a: Action, b: Action): boolean {
    return (
        JSON.stringify(normalizeForImporterCompare(a)) ===
        JSON.stringify(normalizeForImporterCompare(b))
    );
}

function conditionsEqualForAction(a: Condition, b: Condition): boolean {
    return (
        JSON.stringify(normalizeForImporterCompare(a)) ===
        JSON.stringify(normalizeForImporterCompare(b))
    );
}

function objectKeys(value: object): string[] {
    return Object.keys(value);
}

function getFieldValue(value: object, key: string): unknown {
    return (value as { [key: string]: unknown })[key];
}

function fieldEqual(observed: unknown, desired: unknown): boolean {
    return (
        JSON.stringify(normalizeForImporterCompare(observed)) ===
        JSON.stringify(normalizeForImporterCompare(desired))
    );
}

function fieldDifferenceCount(
    observed: object,
    desired: object,
    ignoredKeys: Set<string> = new Set()
): number {
    let cost = 0;
    const keys = new Set([...objectKeys(observed), ...objectKeys(desired)]);

    for (const key of keys) {
        if (ignoredKeys.has(key)) {
            continue;
        }

        if (
            !fieldEqual(getFieldValue(observed, key), getFieldValue(desired, key))
        ) {
            cost += 1;
        }
    }

    return cost;
}

function onlyNoteDiffers(desired: Action, current: Action): boolean {
    return (
        desired.type === current.type &&
        fieldDifferenceCount(desired, current, new Set(["note"])) === 0 &&
        !fieldEqual(desired.note, current.note)
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
    if (conditionsEqualForAction(observed, desired)) {
        return 0;
    }

    return fieldDifferenceCount(observed, desired);
}

function conditionListCost(observed: Condition[], desired: Condition[]): number {
    const unmatchedObserved = observed.map((condition, index) => ({ index, condition }));
    const unmatchedDesired = desired.map((condition, index) => ({ index, condition }));

    for (let desiredIndex = unmatchedDesired.length - 1; desiredIndex >= 0; desiredIndex--) {
        const desiredEntry = unmatchedDesired[desiredIndex];
        const observedIndex = unmatchedObserved.findIndex((entry) =>
            conditionsEqualForAction(entry.condition, desiredEntry.condition)
        );

        if (observedIndex === -1) {
            continue;
        }

        unmatchedObserved.splice(observedIndex, 1);
        unmatchedDesired.splice(desiredIndex, 1);
    }

    const remainingTypes = new Set(
        unmatchedDesired.map((entry) => entry.condition.type)
    );

    let cost = 0;
    for (const type of remainingTypes) {
        const observedBucket = unmatchedObserved.filter(
            (entry) => entry.condition.type === type
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
    observed: MatchableAction,
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

    const nestedProps = new Set(
        getNestedListFields(observed.action.type).map((field) => field.prop)
    );

    let cost =
        circularMoveDistance(observed.index, desired.index, listLength);

    cost += fieldDifferenceCount(observed.action, desired.action, nestedProps);

    for (const prop of nestedProps) {
        const observedValue = getFieldValue(observed.action, prop);
        const desiredValue = getFieldValue(desired.action, prop);

        if (!Array.isArray(observedValue) || !Array.isArray(desiredValue)) {
            if (!fieldEqual(observedValue, desiredValue)) {
                cost += 1;
            }
            continue;
        }

        if (prop === "conditions") {
            cost += conditionListCost(observedValue as Condition[], desiredValue as Condition[]);
            continue;
        }

        cost += actionListCost(observedValue as Action[], desiredValue as Action[]);
    }

    return cost;
}

function takeMatches<TObserved extends MatchableAction>(
    unmatchedObserved: TObserved[],
    unmatchedDesired: DesiredActionEntry[],
    predicate: (observed: TObserved, desired: DesiredActionEntry) => boolean,
    kind: ActionMatchKind,
    costForMatch: (observed: TObserved, desired: DesiredActionEntry) => number
): ActionMatch<TObserved>[] {
    const matches: ActionMatch<TObserved>[] = [];

    for (let desiredIndex = unmatchedDesired.length - 1; desiredIndex >= 0; desiredIndex--) {
        const desiredEntry = unmatchedDesired[desiredIndex];
        const observedIndex = unmatchedObserved.findIndex((entry) =>
            predicate(entry, desiredEntry)
        );

        if (observedIndex === -1) {
            continue;
        }

        const [observed] = unmatchedObserved.splice(observedIndex, 1);
        unmatchedDesired.splice(desiredIndex, 1);
        matches.push({
            observed,
            desiredIndex: desiredEntry.index,
            desired: desiredEntry.action,
            kind,
            cost: costForMatch(observed, desiredEntry),
        });
    }

    return matches;
}

function matchSameTypeBucketGreedy<TObserved extends MatchableAction>(
    observed: TObserved[],
    desired: DesiredActionEntry[],
    listLength: number
): ActionMatch<TObserved>[] {
    const candidates: Array<{
        observed: TObserved;
        desired: DesiredActionEntry;
        cost: number;
    }> = [];

    for (const desiredEntry of desired) {
        for (const observedEntry of observed) {
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

    const usedObserved = new Set<TObserved>();
    const usedDesired = new Set<number>();
    const matches: ActionMatch<TObserved>[] = [];

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

    return matches;
}

function matchActions<TObserved extends MatchableAction>(
    observed: TObserved[],
    desired: Action[],
    listLength: number
): {
    matches: ActionMatch<TObserved>[];
    unmatchedObserved: TObserved[];
    unmatchedDesired: DesiredActionEntry[];
} {
    const unmatchedObserved = [...observed];
    const unmatchedDesired = desired.map((action, index) => ({ index, action }));
    const matches: ActionMatch<TObserved>[] = [];

    matches.push(
        ...takeMatches(
            unmatchedObserved,
            unmatchedDesired,
            (entry, desiredEntry) => actionsEqual(entry.action, desiredEntry.action),
            "exact",
            () => 0
        )
    );

    matches.push(
        ...takeMatches(
            unmatchedObserved,
            unmatchedDesired,
            (entry, desiredEntry) => onlyNoteDiffers(desiredEntry.action, entry.action),
            "note_only",
            () => NOTE_ONLY_COST
        )
    );

    const remainingTypes = new Set(unmatchedDesired.map((entry) => entry.action.type));
    for (const type of remainingTypes) {
        const observedBucket = unmatchedObserved.filter((entry) => entry.action.type === type);
        const desiredBucket = unmatchedDesired.filter((entry) => entry.action.type === type);
        if (observedBucket.length === 0 || desiredBucket.length === 0) {
            continue;
        }

        const bucketMatches = matchSameTypeBucketGreedy(
            observedBucket,
            desiredBucket,
            listLength
        );
        matches.push(...bucketMatches);

        const matchedObserved = new Set(bucketMatches.map((match) => match.observed));
        const matchedDesiredIndices = new Set(
            bucketMatches.map((match) => match.desiredIndex)
        );

        for (let index = unmatchedObserved.length - 1; index >= 0; index--) {
            if (matchedObserved.has(unmatchedObserved[index])) {
                unmatchedObserved.splice(index, 1);
            }
        }

        for (let index = unmatchedDesired.length - 1; index >= 0; index--) {
            if (matchedDesiredIndices.has(unmatchedDesired[index].index)) {
                unmatchedDesired.splice(index, 1);
            }
        }
    }

    matches.sort((a, b) => a.desiredIndex - b.desiredIndex);

    return {
        matches,
        unmatchedObserved,
        unmatchedDesired,
    };
}

function actionListCost(observed: Action[], desired: Action[]): number {
    const matchResult = matchActions(
        observed.map((action, index) => ({
            index,
            type: action.type,
            action,
        })),
        desired,
        observed.length
    );

    return matchResult.matches.reduce((total, match) => total + match.cost, 0);
}

export function diffActionList(
    readActions: ObservedAction[],
    desired: Action[]
): ActionListDiff {
    const matchResult = matchActions(readActions, desired, readActions.length);
    const operations: ActionListOperation[] = [];

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
                action: match.observed.action,
            });
        }

        if (!actionsEqual(match.observed.action, match.desired)) {
            operations.push({
                kind: "edit",
                observed: match.observed,
                desired: match.desired,
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
