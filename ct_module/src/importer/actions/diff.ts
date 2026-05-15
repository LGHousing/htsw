import type { Action, Condition } from "htsw/types";

import { ACTION_MAPPINGS } from "../actionMappings";
import {
    actionOnlyNoteDiffers,
    actionsEqual,
    conditionsEqual,
    scalarFieldDiffers,
} from "../compare";
import { CONDITION_MAPPINGS } from "../conditionMappings";
import { diffConditionList } from "../conditions/diff";
import type {
    ActionListDiff,
    ActionListOperation,
    NestedListDiff,
    NestedListProp,
    Observed,
    ObservedActionSlot,
    ObservedConditionSlot,
    UiFieldKind,
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
const UNREAD_NESTED_ACTION_COST = 1000;

// Real input costs per field kind (based on actual helper implementations)
// These represent the number of server interactions when a field needs changing.
const FIELD_KIND_COST: Record<string, number> = {
    boolean: 1,   // setBooleanValue: 1 click (toggle)
    cycle: 2,     // setCycleValue: avg ~2 clicks (shortest direction)
    select: 2,    // setSelectValue: 1 click open submenu + 1 click option
    value: 2,     // setStringValue/setNumberValue: 1 click field + 1 chat/anvil input
    item: 2,      // setItemValue: 1 click field + 1 click item
    nestedList: 50, // recursive sync — extremely expensive
};

// Fixed overhead for opening an action editor and going back (only paid if any field differs)
const EDIT_OPEN_CLOSE_COST = 2;

function getFieldValue(value: object, key: string): unknown {
    return (value as { [key: string]: unknown })[key];
}

function fieldDifferenceCost(
    observed: Record<string, unknown>,
    desired: Record<string, unknown>,
    type: string,
    scalarProps: { prop: string; kind: UiFieldKind }[]
): number {
    let cost = 0;
    for (const field of scalarProps) {
        if (scalarFieldDiffers(observed, desired, type, field.prop)) {
            cost += FIELD_KIND_COST[field.kind] ?? 1;
        }
    }
    return cost;
}

function splitLoreFields(type: Action["type"]): {
    nestedProps: NestedListProp[];
    scalarProps: { prop: string; kind: UiFieldKind }[];
} {
    const loreFields = ACTION_MAPPINGS[type].loreFields as Record<
        string,
        { prop: string; kind: UiFieldKind }
    >;
    const nestedProps: NestedListProp[] = [];
    const scalarProps: { prop: string; kind: UiFieldKind }[] = [];
    for (const label in loreFields) {
        const field = loreFields[label];
        if (field.kind === "nestedList") {
            nestedProps.push(field.prop as NestedListProp);
        } else {
            scalarProps.push({ prop: field.prop, kind: field.kind });
        }
    }
    return { nestedProps, scalarProps };
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

    const loreFields = CONDITION_MAPPINGS[observed.type].loreFields as Record<
        string,
        { prop: string; kind: UiFieldKind }
    >;
    const scalarProps: { prop: string; kind: UiFieldKind }[] = [];
    for (const label in loreFields) {
        const field = loreFields[label];
        if (field.kind === "nestedList") continue;
        scalarProps.push({ prop: field.prop, kind: field.kind });
    }

    return (
        fieldDifferenceCost(observed, desired, observed.type, scalarProps) +
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

    if (actionOnlyNoteDiffers(desired.action, observed.action)) {
        return NOTE_ONLY_COST;
    }

    const { nestedProps, scalarProps } = splitLoreFields(observed.action.type);

    // Move cost: 1 input per position shifted
    let cost = circularMoveDistance(observed.index, desired.index, listLength);
    if (
        observed.nestedReadState === "summary" &&
        nestedProps.some((prop) => (observed.nestedSummaries?.[prop] ?? []).length > 0)
    ) {
        cost += UNREAD_NESTED_ACTION_COST;
    }

    // Scalar field edit cost: weighted by field kind, computed from
    // normalised field comparison so e.g. volume "0.7" vs 0.7 doesn't add
    // a phantom 2-cost when the values are equal in canonical form.
    const scalarCost = fieldDifferenceCost(
        observed.action,
        desired.action,
        observed.action.type,
        scalarProps
    );
    const noteCost = observed.action.note === desired.action.note ? 0 : 1;

    // Add open/close overhead only if any editing is needed
    if (scalarCost > 0 || noteCost > 0) {
        cost += EDIT_OPEN_CLOSE_COST + scalarCost + noteCost;
    }

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

    // Pass 1: Exact matching with position preference.
    // When multiple observed actions are identical (e.g. repeated `var z = "d"`),
    // prefer the one at the same index to avoid unnecessary moves.
    for (let desiredIndex = 0; desiredIndex < unmatchedDesired.length; desiredIndex++) {
        const desiredEntry = unmatchedDesired[desiredIndex];

        // Prefer same-index match first to preserve positional stability
        let observedIndex = unmatchedObserved.findIndex((entry) =>
            entry.index === desiredEntry.index && actionsEqual(entry.action, desiredEntry.action)
        );
        // Fall back to any matching observed action
        if (observedIndex === -1) {
            observedIndex = unmatchedObserved.findIndex((entry) =>
                actionsEqual(entry.action, desiredEntry.action)
            );
        }
        if (observedIndex === -1) {
            continue;
        }

        const [matchedObserved] = unmatchedObserved.splice(observedIndex, 1);
        unmatchedDesired.splice(desiredIndex, 1);
        desiredIndex--;
        matches.push({
            observed: matchedObserved,
            desiredIndex: desiredEntry.index,
            desired: desiredEntry.action,
            kind: "exact",
            cost: 0,
        });
    }

    // Pass 2: Note-only matching with same position preference.
    for (let desiredIndex = 0; desiredIndex < unmatchedDesired.length; desiredIndex++) {
        const desiredEntry = unmatchedDesired[desiredIndex];
        let observedIndex = unmatchedObserved.findIndex((entry) =>
            entry.index === desiredEntry.index && actionOnlyNoteDiffers(desiredEntry.action, entry.action)
        );
        if (observedIndex === -1) {
            observedIndex = unmatchedObserved.findIndex((entry) =>
                actionOnlyNoteDiffers(desiredEntry.action, entry.action)
            );
        }
        if (observedIndex === -1) {
            continue;
        }

        const [matchedObserved] = unmatchedObserved.splice(observedIndex, 1);
        unmatchedDesired.splice(desiredIndex, 1);
        desiredIndex--;
        matches.push({
            observed: matchedObserved,
            desiredIndex: desiredEntry.index,
            desired: desiredEntry.action,
            kind: "note_only",
            cost: NOTE_ONLY_COST,
        });
    }

    // Pass 3: Same-type matching with position preference.
    // First pin same-index same-type pairs (avoids unnecessary moves for stable-order imports),
    // then fall back to cost-based greedy matching for remaining unpinned actions.
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

        const usedObserved = new Set<KnownObservedAction>();
        const usedDesired = new Set<number>();

        // Position-preference: pin same-type actions that share the same index.
        // This eliminates moves when the list order hasn't changed (programmatic imports).
        for (const desiredEntry of desiredBucket) {
            const positionalMatch = observedBucket.find(
                (entry) => entry.index === desiredEntry.index && !usedObserved.has(entry)
            );
            if (positionalMatch) {
                usedObserved.add(positionalMatch);
                usedDesired.add(desiredEntry.index);
                matches.push({
                    observed: positionalMatch,
                    desiredIndex: desiredEntry.index,
                    desired: desiredEntry.action,
                    kind: "same_type",
                    cost: actionCost(positionalMatch, desiredEntry, listLength),
                });
            }
        }

        // Cost-based greedy matching for remaining unpinned actions.
        const remainingObservedBucket = observedBucket.filter((e) => !usedObserved.has(e));
        const remainingDesiredBucket = desiredBucket.filter((e) => !usedDesired.has(e.index));

        if (remainingObservedBucket.length > 0 && remainingDesiredBucket.length > 0) {
            const candidates: Array<{
                observed: KnownObservedAction;
                desired: DesiredActionEntry;
                cost: number;
            }> = [];

            for (const desiredEntry of remainingDesiredBucket) {
                for (const observedEntry of remainingObservedBucket) {
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

function observedActionsAsSlots(
    observed: Array<Observed<Action> | null>
): ObservedActionSlot[] {
    return observed.map((action, index) => ({
        index,
        slotId: -1,
        slot: null as never,
        action,
        nestedReadState: "full",
    }));
}

function observedConditionsAsSlots(
    observed: Array<Condition | null>
): ObservedConditionSlot[] {
    return observed.map((condition, index) => ({
        index,
        slotId: -1,
        slot: null as never,
        condition,
    }));
}

function nestedActionDiff(
    prop: "ifActions" | "elseActions" | "actions",
    observed: unknown,
    desired: unknown
): NestedListDiff | null {
    const observedList = Array.isArray(observed)
        ? (observed as Array<Observed<Action> | null>)
        : [];
    const desiredList = Array.isArray(desired) ? (desired as Action[]) : [];
    const diff = diffActionListInner(observedActionsAsSlots(observedList), desiredList, false);
    if (diff.operations.length === 0) return null;
    return { prop, diff };
}

function nestedConditionDiff(
    observed: unknown,
    desired: unknown
): NestedListDiff | null {
    const observedList = Array.isArray(observed)
        ? (observed as Array<Condition | null>)
        : [];
    const desiredList = Array.isArray(desired) ? (desired as Condition[]) : [];
    const diff = diffConditionList(observedConditionsAsSlots(observedList), desiredList);
    if (diff.operations.length === 0) return null;
    return { prop: "conditions", diff };
}

function getNestedDiffs(
    observed: Observed<Action>,
    desired: Action,
    includeNested: boolean
): NestedListDiff[] {
    if (!includeNested || observed.type !== desired.type) return [];

    const out: NestedListDiff[] = [];
    if (observed.type === "CONDITIONAL" && desired.type === "CONDITIONAL") {
        const conditions = nestedConditionDiff(observed.conditions, desired.conditions);
        if (conditions !== null) out.push(conditions);

        const ifActions = nestedActionDiff("ifActions", observed.ifActions, desired.ifActions);
        if (ifActions !== null) out.push(ifActions);

        const elseActions = nestedActionDiff(
            "elseActions",
            observed.elseActions,
            desired.elseActions
        );
        if (elseActions !== null) out.push(elseActions);
    } else if (observed.type === "RANDOM" && desired.type === "RANDOM") {
        const actions = nestedActionDiff("actions", observed.actions, desired.actions);
        if (actions !== null) out.push(actions);
    }
    return out;
}

function createEditOperation(
    match: ActionMatch,
    includeNested: boolean
): Extract<ActionListOperation, { kind: "edit" }> {
    const noteOnly = match.kind === "note_only";
    return {
        kind: "edit",
        observed: match.observed,
        desired: match.desired,
        noteOnly,
        noteDiffers: match.observed.action.note !== match.desired.note,
        nestedDiffs: noteOnly
            ? []
            : getNestedDiffs(match.observed.action, match.desired, includeNested),
    };
}

export function diffActionList(
    readActions: ObservedActionSlot[],
    desired: Action[]
): ActionListDiff {
    return diffActionListInner(readActions, desired, true);
}

function diffActionListInner(
    readActions: ObservedActionSlot[],
    desired: Action[],
    includeNested: boolean
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
            operations.push(createEditOperation(match, includeNested));
        }
    }

    for (const unmatched of matchResult.unmatchedDesired) {
        operations.push({
            kind: "add",
            desired: unmatched.action,
            toIndex: unmatched.index,
        });
    }

    return { operations, desiredLength: desired.length };
}
