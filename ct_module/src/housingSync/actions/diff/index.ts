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
    fieldValueMatchesDefault,
    notesEqual,
    scalarFieldDiffers,
} from "../comparison";
import { CONDITION_MAPPINGS } from "../../fields/conditionMappings";
import {
    baselineConditionListFromConditions,
    diffConditionList,
} from "../conditions/diff";
import type {
    ActionListDiff,
    ActionListOperation,
    ChildActionListDiff,
    ChildActionListOperation,
    ChildConditionListDiff,
    ChildListDiff,
    CurrentActionListEntry,
    RootAction,
} from "./types";
import { assertOneLevelActionTree, isChildAction } from "../childActions";
import type { ChildActionListName, ChildListName } from "../../actionPath";
import type { Observed, ObservedActionSlot } from "../../observedActions";
import type { UiFieldKind } from "../../fields/loreSpecs";
import { isChildListFieldKind } from "../../fields/loreSpecs";
import type { ItemDiffContext } from "./itemDiffContext";

export type KnownCurrentAction = Omit<CurrentActionListEntry, "action"> & {
    action: NonNullable<CurrentActionListEntry["action"]>;
};

export type DesiredActionEntry = {
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

function plannedAction(action: Action): RootAction {
    return action as RootAction;
}

function plannedObservedAction(action: Observed): Observed<RootAction> {
    return action;
}

const NOTE_ONLY_COST = 1;
const ADD_OVERHEAD_COST = 2;

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
    observed: Action | Observed,
    desired: Action
): boolean {
    return itemDiff?.actionsDiffer(observed, desired) === true;
}

function itemConditionDiffers(
    itemDiff: ItemDiffContext | undefined,
    observed: Condition | null,
    desired: Condition
): boolean {
    return itemDiff?.conditionsDiffer(observed, desired) === true;
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

function scalarCreationCost(
    value: Record<string, unknown>,
    type: string,
    scalarProps: { prop: string; kind: UiFieldKind }[]
): number {
    let cost = 0;
    for (const field of scalarProps) {
        const fieldValue = value[field.prop];
        if (
            fieldValue !== undefined &&
            !fieldValueMatchesDefault(type, field.prop, fieldValue)
        ) {
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
        (notesEqual(observed.note, desired.note) ? 0 : 1)
    );
}

function conditionCreationCost(condition: Condition): number {
    const loreFields = CONDITION_MAPPINGS[condition.type].loreFields as Record<
        string,
        { prop: string; kind: UiFieldKind }
    >;
    const scalarProps: { prop: string; kind: UiFieldKind }[] = [];
    for (const label in loreFields) {
        const field = loreFields[label];
        if (!isChildListFieldKind(field.kind)) {
            scalarProps.push({ prop: field.prop, kind: field.kind });
        }
    }

    return (
        ADD_OVERHEAD_COST +
        scalarCreationCost(condition, condition.type, scalarProps) +
        (condition.inverted === true ? 1 : 0) +
        (condition.note === undefined ? 0 : NOTE_ONLY_COST)
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
            if (candidate.cost > 1 + conditionCreationCost(candidate.desired.condition)) {
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
            cost += conditionCreationCost(entry.condition);
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
            entry.editable &&
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
            entry.editable &&
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
            entry.editable &&
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
            entry.editable &&
            !itemActionDiffers(itemDiff, entry.action, desired.action) &&
            actionOnlyNoteDiffers(desired.action, entry.action)
    );
}

export function actionCost(
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
    const noteCost = notesEqual(current.action.note, desired.action.note) ? 0 : 1;

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
                observedValue as Array<Observed | null>,
                desiredValue as Action[],
                itemDiff
            );
        }
    }

    return cost;
}

export function actionCreationCost(action: Action): number {
    const { childListNames, scalarProps } = splitLoreFields(action.type);
    let cost =
        ADD_OVERHEAD_COST +
        scalarCreationCost(action, action.type, scalarProps) +
        (action.note === undefined ? 0 : NOTE_ONLY_COST);

    for (const prop of childListNames) {
        const value = getFieldValue(action, prop);
        if (!Array.isArray(value)) continue;
        if (prop === "conditions") {
            cost += conditionListCost([], value as Condition[]);
        } else {
            cost += actionListCost([], value as Action[]);
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

    // Match note-only edits next, preferring the same position.
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

    // Match same-type actions next, preferring the same position.
    // First pin same-index same-type pairs (avoids unnecessary moves for stable-order imports),
    // then fall back to cost-based greedy matching for remaining unpinned actions.
    const remainingTypes = new Set(unmatchedDesired.map((entry) => entry.action.type));
    for (const type of remainingTypes) {
        const currentBucket = unmatchedCurrent.filter(
            (entry) => entry.editable && entry.action.type === type
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
                const cost = actionCost(
                    positionalMatch,
                    desiredEntry,
                    listLength,
                    itemDiff
                );
                if (cost > 1 + actionCreationCost(desiredEntry.action)) {
                    continue;
                }
                usedCurrent.add(positionalMatch);
                usedDesired.add(desiredEntry.index);
                matches.push({
                    current: positionalMatch,
                    desiredIndex: desiredEntry.index,
                    desired: desiredEntry.action,
                    kind: "same_type",
                    cost,
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
                if (candidate.cost > 1 + actionCreationCost(candidate.desired.action)) {
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

export function actionListCost(
    observed: Array<Observed | null>,
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
    cost += matchResult.unmatchedDesired.reduce(
        (total, entry) => total + actionCreationCost(entry.action),
        0
    );
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
            editable: slots[i].hydrated,
        });
    }
    return out;
}

export function baselineActionListFromActions(
    actions: ReadonlyArray<Observed | Action | null>
): CurrentActionListEntry[] {
    const out: CurrentActionListEntry[] = [];
    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        out.push({
            entryId: i,
            index: i,
            action,
            editable: true,
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
        ? (observed as Array<Observed | null>)
        : [];
    const desiredList = Array.isArray(desired) ? (desired as Action[]) : [];
    const diff = diffChildActionList(
        baselineActionListFromActions(observedList),
        desiredList,
        itemDiff
    );
    if (diff.operations.length === 0) return null;
    return { kind: "actions", prop, diff };
}

function assertChildActionList(
    current: readonly CurrentActionListEntry[],
    desired: readonly Action[]
): void {
    for (let i = 0; i < current.length; i++) {
        const action = current[i].action;
        if (action !== null && !isChildAction(action)) {
            throw new Error(
                `${action.type} action cannot appear inside an action child list.`
            );
        }
    }
    for (let i = 0; i < desired.length; i++) {
        if (!isChildAction(desired[i])) {
            throw new Error(
                `${desired[i].type} action cannot appear inside an action child list.`
            );
        }
    }
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
    return { kind: "conditions", prop: "conditions", diff };
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

function getAddedChildListDiffs(
    desired: Action,
    itemDiff?: ItemDiffContext
): ChildListDiff[] {
    const out: ChildListDiff[] = [];
    for (const field of getChildListFields(desired.type)) {
        const desiredList = getFieldValue(desired, field.prop);
        const diff =
            field.kind === "conditionList"
                ? childConditionListDiff([], desiredList, itemDiff)
                : childActionListDiff(field.prop, [], desiredList, itemDiff);
        if (diff !== null) out.push(diff);
    }
    return out;
}

function conditionChildListDiffsOnly(
    childListDiffs: ChildListDiff[]
): ChildConditionListDiff[] {
    const out: ChildConditionListDiff[] = [];
    for (const childList of childListDiffs) {
        if (childList.kind === "actions") {
            throw new Error(
                `Action child list "${childList.prop}" reached a child action.`
            );
        }
        out.push(childList);
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
        baselineAction: plannedObservedAction(match.current.action),
        desired: plannedAction(match.desired),
        noteOnly,
        noteDiffers: !notesEqual(match.current.action.note, match.desired.note),
        childListDiffs: noteOnly
            ? []
            : getChildListDiffs(match.current, match.desired, itemDiff),
    };
}

function createChildListEditOperation(
    match: ActionMatch,
    itemDiff?: ItemDiffContext
): Extract<ChildActionListOperation, { kind: "edit" }> {
    const noteOnly = match.kind === "note_only";
    if (!isChildAction(match.current.action) || !isChildAction(match.desired)) {
        throw new Error("Container action reached a child action-list diff.");
    }
    return {
        kind: "edit",
        entryId: match.current.entryId,
        fromIndex: match.current.index,
        desiredIndex: match.desiredIndex,
        baselineAction: match.current.action,
        desired: match.desired,
        noteOnly,
        noteDiffers: !notesEqual(match.current.action.note, match.desired.note),
        childListDiffs: noteOnly
            ? []
            : conditionChildListDiffsOnly(
                  getChildListDiffs(match.current, match.desired, itemDiff)
              ),
    };
}

export function diffActionList(
    current: CurrentActionListEntry[],
    desired: Action[],
    itemDiff?: ItemDiffContext
): ActionListDiff {
    assertOneLevelActionTree(current.map((entry) => entry.action));
    assertOneLevelActionTree(desired);
    return diffActionListCore(
        current,
        desired,
        createEditOperation,
        (action) => getAddedChildListDiffs(action, itemDiff),
        itemDiff
    );
}

function diffChildActionList(
    current: CurrentActionListEntry[],
    desired: Action[],
    itemDiff?: ItemDiffContext
): ChildActionListDiff {
    assertChildActionList(current, desired);
    const diff = diffActionListCore(
        current,
        desired,
        createChildListEditOperation,
        (action) => {
            if (!isChildAction(action)) {
                throw new Error(
                    `${action.type} action cannot appear inside an action child list.`
                );
            }
            return conditionChildListDiffsOnly(getAddedChildListDiffs(action, itemDiff));
        },
        itemDiff
    );
    return {
        operations: diff.operations as ChildActionListOperation[],
        desiredLength: diff.desiredLength,
    };
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
    childListDiffsForAdd: (action: Action) => ChildListDiff[],
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
            baselineAction:
                currentEntry.action === null
                    ? null
                    : plannedObservedAction(currentEntry.action),
        });
    }

    for (const currentEntry of matchResult.unmatchedCurrent) {
        operations.push({
            kind: "delete",
            entryId: currentEntry.entryId,
            fromIndex: currentEntry.index,
            baselineAction: plannedObservedAction(currentEntry.action),
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
                action: plannedAction(match.desired),
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
            desired: plannedAction(unmatched.action),
            toIndex: unmatched.index,
            childListDiffs: childListDiffsForAdd(unmatched.action),
        });
    }

    return { operations, desiredLength: desired.length };
}
