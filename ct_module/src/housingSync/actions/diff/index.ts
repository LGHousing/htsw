import type { Action, Condition } from "htsw/types";

import {
    ACTION_MAPPINGS,
    getActionScalarLoreFields,
    getChildListFields,
} from "../../fields/actionMappings";
import {
    actionOnlyNoteDiffers,
    actionsEqual,
    conditionsEqual,
    scalarFieldDiffers,
} from "../../fields/compare";
import { CONDITION_MAPPINGS } from "../../fields/conditionMappings";
import {
    baselineConditionListFromConditions,
    diffConditionList,
} from "../conditions/diff";
import type {
    ActionListDiff,
    ActionListOperation,
    ChildListDiff,
    CurrentActionListEntry,
} from "./types";
import type { ChildActionListName, ChildListName } from "../../actionPath";
import type { Observed, ObservedActionSlot } from "../../observedActions";
import type { UiFieldKind } from "../../fields/loreSpecs";
import { isChildListFieldKind } from "../../fields/loreSpecs";
import type { ItemDiffContext } from "./itemDiffContext";

type KnownCurrentAction = Omit<CurrentActionListEntry, "action"> & {
    action: NonNullable<CurrentActionListEntry["action"]>;
};

type DesiredActionEntry = {
    index: number;
    action: Action;
};

type ActionMatchKind = "exact" | "note_only" | "same_type";

type ActionMatch = {
    current: KnownCurrentAction;
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

// How many server interactions it takes to change a field of each kind.
const FIELD_KIND_COST: Record<string, number> = {
    boolean: 1, // one click to toggle
    cycle: 2, // ~2 clicks, cycling the shortest direction
    select: 2, // open the submenu, click the option
    location: 2,
    value: 2, // click the field, then type the value
    item: 2, // click the field, then click the item
    actionList: 50,
    conditionList: 50,
};

// Fixed overhead for opening an action editor and going back (only paid if any field differs)
const EDIT_OPEN_CLOSE_COST = 2;

function itemActionDiffers(
    itemDiff: ItemDiffContext | undefined,
    observed: Action | Observed<Action>,
    desired: Action
): boolean {
    return (
        itemDiff?.hasAction(desired) === true ||
        itemDiff?.actionsDiffer(observed, desired) === true
    );
}

function itemConditionDiffers(
    itemDiff: ItemDiffContext | undefined,
    observed: Condition | null,
    desired: Condition
): boolean {
    return (
        itemDiff?.hasCondition(desired) === true ||
        itemDiff?.conditionsDiffer(observed, desired) === true
    );
}

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
    childListNames: ChildListName[];
    scalarProps: { prop: string; kind: UiFieldKind }[];
} {
    const loreFields = ACTION_MAPPINGS[type].loreFields as Record<
        string,
        { prop: string; kind: UiFieldKind }
    >;
    const childListNames: ChildListName[] = [];
    const scalarProps: { prop: string; kind: UiFieldKind }[] = [];
    for (const label in loreFields) {
        const field = loreFields[label];
        if (isChildListFieldKind(field.kind)) {
            childListNames.push(field.prop as ChildListName);
        } else {
            scalarProps.push({ prop: field.prop, kind: field.kind });
        }
    }
    return { childListNames, scalarProps };
}

function circularMoveDistance(from: number, to: number, listLength: number): number {
    if (listLength <= 1) {
        return 0;
    }

    const directDistance = Math.abs(from - to);
    return Math.min(directDistance, listLength - directDistance);
}

function conditionCost(
    observed: Condition,
    desired: Condition,
    itemDiff?: ItemDiffContext
): number {
    const itemDiffers = itemConditionDiffers(itemDiff, observed, desired);
    if (!itemDiffers && conditionsEqual(observed, desired)) {
        return 0;
    }

    const loreFields = CONDITION_MAPPINGS[observed.type].loreFields as Record<
        string,
        { prop: string; kind: UiFieldKind }
    >;
    const scalarProps: { prop: string; kind: UiFieldKind }[] = [];
    for (const label in loreFields) {
        const field = loreFields[label];
        if (isChildListFieldKind(field.kind)) continue;
        scalarProps.push({ prop: field.prop, kind: field.kind });
    }

    return (
        fieldDifferenceCost(observed, desired, observed.type, scalarProps) +
        (itemDiffers ? FIELD_KIND_COST.item : 0) +
        (observed.inverted === desired.inverted ? 0 : 1) +
        (observed.note === desired.note ? 0 : 1)
    );
}

function conditionListCost(
    observed: Array<Condition | null>,
    desired: Condition[],
    itemDiff?: ItemDiffContext
): number {
    const unmatchedObserved = observed.map((condition, index) => ({ index, condition }));
    const unmatchedDesired = desired.map((condition, index) => ({ index, condition }));

    for (
        let desiredIndex = unmatchedDesired.length - 1;
        desiredIndex >= 0;
        desiredIndex--
    ) {
        const desiredEntry = unmatchedDesired[desiredIndex];
        let observedIndex = -1;
        for (let i = 0; i < unmatchedObserved.length; i++) {
            if (
                !itemConditionDiffers(
                    itemDiff,
                    unmatchedObserved[i].condition,
                    desiredEntry.condition
                ) &&
                conditionsEqual(unmatchedObserved[i].condition, desiredEntry.condition)
            ) {
                observedIndex = i;
                break;
            }
        }

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
    const matchedObserved = new Set<number>();
    const matchedDesired = new Set<number>();

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
                    cost: conditionCost(
                        observedEntry.condition,
                        desiredEntry.condition,
                        itemDiff
                    ),
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
            matchedObserved.add(candidate.observed.index);
            matchedDesired.add(candidate.desired.index);
            cost += candidate.cost;
        }
    }

    for (const entry of unmatchedObserved) {
        if (entry.condition !== null && !matchedObserved.has(entry.index)) {
            cost += 1;
        }
    }
    for (const entry of unmatchedDesired) {
        if (!matchedDesired.has(entry.index)) {
            cost += 1;
        }
    }

    return cost;
}

function indexOfAction(
    current: readonly KnownCurrentAction[],
    predicate: (entry: KnownCurrentAction) => boolean
): number {
    for (let i = 0; i < current.length; i++) {
        if (predicate(current[i])) return i;
    }
    return -1;
}

function indexOfExactActionAtDesiredIndex(
    current: readonly KnownCurrentAction[],
    desired: DesiredActionEntry,
    itemDiff?: ItemDiffContext
): number {
    return indexOfAction(
        current,
        (entry) =>
            entry.index === desired.index &&
            !itemActionDiffers(itemDiff, entry.action, desired.action) &&
            actionsEqual(entry.action, desired.action)
    );
}

function indexOfExactActionAtAnyIndex(
    current: readonly KnownCurrentAction[],
    desired: DesiredActionEntry,
    itemDiff?: ItemDiffContext
): number {
    return indexOfAction(
        current,
        (entry) =>
            !itemActionDiffers(itemDiff, entry.action, desired.action) &&
            actionsEqual(entry.action, desired.action)
    );
}

function indexOfNoteOnlyActionAtDesiredIndex(
    current: readonly KnownCurrentAction[],
    desired: DesiredActionEntry,
    itemDiff?: ItemDiffContext
): number {
    return indexOfAction(
        current,
        (entry) =>
            entry.index === desired.index &&
            !itemActionDiffers(itemDiff, entry.action, desired.action) &&
            actionOnlyNoteDiffers(desired.action, entry.action)
    );
}

function indexOfNoteOnlyActionAtAnyIndex(
    current: readonly KnownCurrentAction[],
    desired: DesiredActionEntry,
    itemDiff?: ItemDiffContext
): number {
    return indexOfAction(
        current,
        (entry) =>
            !itemActionDiffers(itemDiff, entry.action, desired.action) &&
            actionOnlyNoteDiffers(desired.action, entry.action)
    );
}

function actionCost(
    current: KnownCurrentAction,
    desired: DesiredActionEntry,
    listLength: number,
    itemDiff?: ItemDiffContext
): number {
    if (current.action.type !== desired.action.type) {
        return Number.POSITIVE_INFINITY;
    }

    const itemDiffers = itemActionDiffers(itemDiff, current.action, desired.action);
    if (!itemDiffers && actionsEqual(current.action, desired.action)) {
        return 0;
    }

    if (!itemDiffers && actionOnlyNoteDiffers(desired.action, current.action)) {
        return NOTE_ONLY_COST;
    }

    const { childListNames, scalarProps } = splitLoreFields(current.action.type);

    // Move cost: 1 input per position shifted
    let cost = circularMoveDistance(current.index, desired.index, listLength);
    // normalised field comparison so e.g. volume "0.7" vs 0.7 doesn't add
    // a phantom 2-cost when the values are equal in canonical form.
    const scalarCost = fieldDifferenceCost(
        current.action,
        desired.action,
        current.action.type,
        scalarProps
    );
    const forcedItemCost = itemDiffers ? FIELD_KIND_COST.item : 0;
    const noteCost = current.action.note === desired.action.note ? 0 : 1;

    // Add open/close overhead only if any editing is needed
    if (scalarCost > 0 || noteCost > 0 || forcedItemCost > 0) {
        cost += EDIT_OPEN_CLOSE_COST + scalarCost + noteCost + forcedItemCost;
    }

    for (const prop of childListNames) {
        const observedValue = getFieldValue(current.action, prop);
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
                desiredValue as Condition[],
                itemDiff
            );
        } else {
            cost += actionListCost(
                observedValue as Array<Observed<Action> | null>,
                desiredValue as Action[],
                itemDiff
            );
        }
    }

    return cost;
}

function matchActions(
    current: KnownCurrentAction[],
    desired: Action[],
    listLength: number,
    itemDiff?: ItemDiffContext
): {
    matches: ActionMatch[];
    unmatchedCurrent: KnownCurrentAction[];
    unmatchedDesired: DesiredActionEntry[];
} {
    const unmatchedCurrent = [...current];
    const unmatchedDesired = desired.map((action, index) => ({ index, action }));
    const matches: ActionMatch[] = [];

    for (let desiredIndex = 0; desiredIndex < unmatchedDesired.length; desiredIndex++) {
        const desiredEntry = unmatchedDesired[desiredIndex];
        let currentIndex = indexOfExactActionAtDesiredIndex(
            unmatchedCurrent,
            desiredEntry,
            itemDiff
        );
        if (currentIndex === -1) {
            currentIndex = indexOfExactActionAtAnyIndex(
                unmatchedCurrent,
                desiredEntry,
                itemDiff
            );
        }
        if (currentIndex === -1) {
            continue;
        }

        const [matchedCurrent] = unmatchedCurrent.splice(currentIndex, 1);
        unmatchedDesired.splice(desiredIndex, 1);
        desiredIndex--;
        matches.push({
            current: matchedCurrent,
            desiredIndex: desiredEntry.index,
            desired: desiredEntry.action,
            kind: "exact",
            cost: 0,
        });
    }

    // Pass 2: Note-only matching with same position preference.
    for (let desiredIndex = 0; desiredIndex < unmatchedDesired.length; desiredIndex++) {
        const desiredEntry = unmatchedDesired[desiredIndex];
        let currentIndex = indexOfNoteOnlyActionAtDesiredIndex(
            unmatchedCurrent,
            desiredEntry,
            itemDiff
        );
        if (currentIndex === -1) {
            currentIndex = indexOfNoteOnlyActionAtAnyIndex(
                unmatchedCurrent,
                desiredEntry,
                itemDiff
            );
        }
        if (currentIndex === -1) {
            continue;
        }

        const [matchedCurrent] = unmatchedCurrent.splice(currentIndex, 1);
        unmatchedDesired.splice(desiredIndex, 1);
        desiredIndex--;
        matches.push({
            current: matchedCurrent,
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
        const currentBucket = unmatchedCurrent.filter(
            (entry) => entry.action.type === type
        );
        const desiredBucket = unmatchedDesired.filter(
            (entry) => entry.action.type === type
        );
        if (currentBucket.length === 0 || desiredBucket.length === 0) {
            continue;
        }

        const usedCurrent = new Set<KnownCurrentAction>();
        const usedDesired = new Set<number>();

        // Position-preference: pin same-type actions that share the same index.
        // This eliminates moves when the list order hasn't changed (programmatic imports).
        for (const desiredEntry of desiredBucket) {
            const positionalMatch = currentBucket.find(
                (entry) => entry.index === desiredEntry.index && !usedCurrent.has(entry)
            );
            if (positionalMatch) {
                usedCurrent.add(positionalMatch);
                usedDesired.add(desiredEntry.index);
                matches.push({
                    current: positionalMatch,
                    desiredIndex: desiredEntry.index,
                    desired: desiredEntry.action,
                    kind: "same_type",
                    cost: actionCost(positionalMatch, desiredEntry, listLength, itemDiff),
                });
            }
        }

        // Cost-based greedy matching for remaining unpinned actions.
        const remainingCurrentBucket = currentBucket.filter((e) => !usedCurrent.has(e));
        const remainingDesiredBucket = desiredBucket.filter(
            (e) => !usedDesired.has(e.index)
        );

        if (remainingCurrentBucket.length > 0 && remainingDesiredBucket.length > 0) {
            const candidates: Array<{
                current: KnownCurrentAction;
                desired: DesiredActionEntry;
                cost: number;
            }> = [];

            for (const desiredEntry of remainingDesiredBucket) {
                for (const currentEntry of remainingCurrentBucket) {
                    candidates.push({
                        current: currentEntry,
                        desired: desiredEntry,
                        cost: actionCost(
                            currentEntry,
                            desiredEntry,
                            listLength,
                            itemDiff
                        ),
                    });
                }
            }

            candidates.sort(
                (a, b) =>
                    a.cost - b.cost ||
                    a.current.index - b.current.index ||
                    a.desired.index - b.desired.index
            );

            for (const candidate of candidates) {
                if (
                    usedCurrent.has(candidate.current) ||
                    usedDesired.has(candidate.desired.index)
                ) {
                    continue;
                }

                usedCurrent.add(candidate.current);
                usedDesired.add(candidate.desired.index);
                matches.push({
                    current: candidate.current,
                    desiredIndex: candidate.desired.index,
                    desired: candidate.desired.action,
                    kind: "same_type",
                    cost: candidate.cost,
                });
            }
        }

        for (let index = unmatchedCurrent.length - 1; index >= 0; index--) {
            if (usedCurrent.has(unmatchedCurrent[index])) {
                unmatchedCurrent.splice(index, 1);
            }
        }

        for (let index = unmatchedDesired.length - 1; index >= 0; index--) {
            if (usedDesired.has(unmatchedDesired[index].index)) {
                unmatchedDesired.splice(index, 1);
            }
        }
    }

    matches.sort((a, b) => a.desiredIndex - b.desiredIndex);

    return { matches, unmatchedCurrent, unmatchedDesired };
}

function actionListCost(
    observed: Array<Observed<Action> | null>,
    desired: Action[],
    itemDiff?: ItemDiffContext
): number {
    const current = baselineActionListFromActions(observed);
    const knownCurrent = current.filter(
        (entry): entry is KnownCurrentAction => entry.action !== null
    );

    const matchResult = matchActions(knownCurrent, desired, observed.length, itemDiff);

    let cost = matchResult.matches.reduce((total, match) => total + match.cost, 0);
    cost += observed.filter((entry) => entry === null).length;
    cost += matchResult.unmatchedCurrent.length;
    cost += matchResult.unmatchedDesired.length;
    return cost;
}

export function baselineActionListFromSlots(
    slots: readonly ObservedActionSlot[]
): CurrentActionListEntry[] {
    const out: CurrentActionListEntry[] = [];
    for (let i = 0; i < slots.length; i++) {
        out.push({
            entryId: i,
            index: slots[i].index,
            action: slots[i].action,
        });
    }
    return out;
}

export function baselineActionListFromActions(
    actions: ReadonlyArray<Observed<Action> | Action | null>
): CurrentActionListEntry[] {
    const out: CurrentActionListEntry[] = [];
    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        out.push({
            entryId: i,
            index: i,
            action,
        });
    }
    return out;
}

function childActionListDiff(
    prop: ChildActionListName,
    observed: unknown,
    desired: unknown,
    itemDiff?: ItemDiffContext
): ChildListDiff | null {
    const observedList = Array.isArray(observed)
        ? (observed as Array<Observed<Action> | null>)
        : [];
    const desiredList = Array.isArray(desired) ? (desired as Action[]) : [];
    const diff = diffChildActionList(
        baselineActionListFromActions(observedList),
        desiredList,
        itemDiff
    );
    if (diff.operations.length === 0) return null;
    return { prop, diff };
}

function childConditionListDiff(
    observed: unknown,
    desired: unknown,
    itemDiff?: ItemDiffContext
): ChildListDiff | null {
    const observedList = Array.isArray(observed)
        ? (observed as Array<Condition | null>)
        : [];
    const desiredList = Array.isArray(desired) ? (desired as Condition[]) : [];
    const diff = diffConditionList(
        baselineConditionListFromConditions(observedList),
        desiredList,
        itemDiff
    );
    if (diff.operations.length === 0) return null;
    return { prop: "conditions", diff };
}

function getChildListDiffs(
    current: KnownCurrentAction,
    desired: Action,
    itemDiff?: ItemDiffContext
): ChildListDiff[] {
    const observed = current.action;
    if (observed.type !== desired.type) return [];

    const out: ChildListDiff[] = [];
    for (const field of getChildListFields(observed.type)) {
        const observedList = getFieldValue(observed, field.prop);
        const desiredList = getFieldValue(desired, field.prop);
        const diff =
            field.kind === "conditionList"
                ? childConditionListDiff(observedList, desiredList, itemDiff)
                : childActionListDiff(field.prop, observedList, desiredList, itemDiff);
        if (diff !== null) out.push(diff);
    }
    return out;
}

function createEditOperation(
    match: ActionMatch,
    itemDiff?: ItemDiffContext
): Extract<ActionListOperation, { kind: "edit" }> {
    const noteOnly = match.kind === "note_only";
    return {
        kind: "edit",
        entryId: match.current.entryId,
        fromIndex: match.current.index,
        desiredIndex: match.desiredIndex,
        baselineAction: match.current.action,
        desired: match.desired,
        noteOnly,
        noteDiffers: match.current.action.note !== match.desired.note,
        childListDiffs: noteOnly
            ? []
            : getChildListDiffs(match.current, match.desired, itemDiff),
    };
}

function createChildListEditOperation(
    match: ActionMatch,
    itemDiff?: ItemDiffContext
): Extract<ActionListOperation, { kind: "edit" }> {
    const noteOnly = match.kind === "note_only";
    return {
        kind: "edit",
        entryId: match.current.entryId,
        fromIndex: match.current.index,
        desiredIndex: match.desiredIndex,
        baselineAction: match.current.action,
        desired: match.desired,
        noteOnly,
        noteDiffers: match.current.action.note !== match.desired.note,
        childListDiffs: noteOnly
            ? []
            : getChildListDiffs(match.current, match.desired, itemDiff),
    };
}

export function diffActionList(
    current: CurrentActionListEntry[],
    desired: Action[],
    itemDiff?: ItemDiffContext
): ActionListDiff {
    return diffActionListCore(current, desired, createEditOperation, itemDiff);
}

function diffChildActionList(
    current: CurrentActionListEntry[],
    desired: Action[],
    itemDiff?: ItemDiffContext
): ActionListDiff {
    return diffActionListCore(current, desired, createChildListEditOperation, itemDiff);
}

function editOpIsObservablyNoop(
    op: Extract<ActionListOperation, { kind: "edit" }>,
    itemDiff?: ItemDiffContext
): boolean {
    if (itemActionDiffers(itemDiff, op.baselineAction, op.desired)) return false;
    if (op.noteDiffers) return false;
    if (op.childListDiffs.length > 0) return false;
    const scalarFields = getActionScalarLoreFields(op.baselineAction.type);
    for (let i = 0; i < scalarFields.length; i++) {
        const field = scalarFields[i];
        if (
            scalarFieldDiffers(
                op.baselineAction,
                op.desired,
                op.baselineAction.type,
                field.prop
            )
        ) {
            return false;
        }
    }
    return true;
}

function diffActionListCore(
    current: CurrentActionListEntry[],
    desired: Action[],
    createEdit: (
        match: ActionMatch,
        itemDiff?: ItemDiffContext
    ) => Extract<ActionListOperation, { kind: "edit" }>,
    itemDiff?: ItemDiffContext
): ActionListDiff {
    const knownCurrent = current.filter(
        (entry): entry is KnownCurrentAction => entry.action !== null
    );
    const unknownCurrent = current.filter((entry) => entry.action === null);
    const matchResult = matchActions(knownCurrent, desired, current.length, itemDiff);
    const operations: ActionListOperation[] = [];

    for (const currentEntry of unknownCurrent) {
        operations.push({
            kind: "delete",
            entryId: currentEntry.entryId,
            fromIndex: currentEntry.index,
            baselineAction: currentEntry.action,
        });
    }

    for (const currentEntry of matchResult.unmatchedCurrent) {
        operations.push({
            kind: "delete",
            entryId: currentEntry.entryId,
            fromIndex: currentEntry.index,
            baselineAction: currentEntry.action,
        });
    }

    const desiredOrderedMatches = [...matchResult.matches].sort(
        (a, b) => a.desiredIndex - b.desiredIndex
    );
    const currentOrder = [...matchResult.matches].sort(
        (a, b) => a.current.index - b.current.index
    );

    for (let targetIndex = 0; targetIndex < desiredOrderedMatches.length; targetIndex++) {
        const match = desiredOrderedMatches[targetIndex];
        const currentIndex = currentOrder.indexOf(match);

        if (currentIndex !== targetIndex) {
            operations.push({
                kind: "move",
                entryId: match.current.entryId,
                fromIndex: match.current.index,
                toIndex: targetIndex,
                action: match.desired,
            });
            currentOrder.splice(currentIndex, 1);
            currentOrder.splice(targetIndex, 0, match);
        }

        if (
            itemActionDiffers(itemDiff, match.current.action, match.desired) ||
            !actionsEqual(match.current.action, match.desired)
        ) {
            const editOp = createEdit(match, itemDiff);
            if (editOpIsObservablyNoop(editOp, itemDiff)) {
                continue;
            }
            operations.push(editOp);
        }
    }

    for (const unmatched of matchResult.unmatchedDesired) {
        operations.push({
            kind: "add",
            desiredIndex: unmatched.index,
            desired: unmatched.action,
            toIndex: unmatched.index,
        });
    }

    return { operations, desiredLength: desired.length };
}
