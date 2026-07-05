import type { Action, Condition } from "htsw/types";

import { getActionLoreFields, getChildListFields } from "../fields/actionMappings";
import type {
    ActionHydrationPlan,
    ChildListName,
    ChildListsToRead,
    ObservedActionSlot,
} from "../types";
import { createActionHydrationWork } from "./hydrationPlan";

const CHILD_LIST_COST_WEIGHT = 20;
const SCALAR_FIELD_COST_WEIGHT = 2;
const NOTE_COST_WEIGHT = 1;
const INDEX_DISTANCE_WEIGHT = 1;

export type DesiredActionEntry = {
    index: number;
    action: Action;
};

export function createActionHydrationPlan(
    matches: Map<ObservedActionSlot, DesiredActionEntry>
): ActionHydrationPlan {
    const plan: ActionHydrationPlan = new Map();
    for (const observed of matches.keys()) {
        const childListsToRead = getChildListsNeedingHydration(observed);
        if (childListsToRead.size > 0) {
            plan.set(observed, createActionHydrationWork(childListsToRead));
        }
    }
    return plan;
}

/**
 * Pair each observed child-list-bearing action with the desired action it
 * most likely represents. Both the hydration plan and trust application read
 * this same pairing, so they always agree on which observed action lines up
 * with which desired one; if they paired independently they could disagree.
 *
 * Only considers observed entries that still have child lists to read (the
 * two consumers act on those entries alone), so it doesn't waste work pairing
 * entries neither of them would touch.
 */
export function matchObservedToDesired(
    observed: readonly ObservedActionSlot[],
    desired: readonly Action[]
): Map<ObservedActionSlot, DesiredActionEntry> {
    type Candidate = {
        observed: ObservedActionSlot;
        desired: DesiredActionEntry;
        cost: number;
    };

    const desiredByType = new Map<Action["type"], DesiredActionEntry[]>();
    desired.forEach((action, index) => {
        const entries = desiredByType.get(action.type) ?? [];
        entries.push({ index, action });
        desiredByType.set(action.type, entries);
    });

    const matches = new Map<ObservedActionSlot, DesiredActionEntry>();
    for (const [type, desiredBucket] of desiredByType) {
        if (getChildListFields(type).length === 0) continue;

        const observedBucket = observed.filter(
            (entry) =>
                entry.action !== null &&
                entry.action.type === type &&
                getChildListsNeedingHydration(entry).size > 0
        );
        if (observedBucket.length === 0) continue;

        const candidates: Candidate[] = [];
        for (const desiredEntry of desiredBucket) {
            for (const observedEntry of observedBucket) {
                candidates.push({
                    observed: observedEntry,
                    desired: desiredEntry,
                    cost: shallowChildListOwnerCost(observedEntry, desiredEntry),
                });
            }
        }
        candidates.sort(
            (a, b) =>
                a.cost - b.cost ||
                a.observed.index - b.observed.index ||
                a.desired.index - b.desired.index
        );

        const usedObserved = new Set<ObservedActionSlot>();
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
            matches.set(candidate.observed, candidate.desired);
        }
    }

    return matches;
}

function getChildListsNeedingHydration(
    entry: ObservedActionSlot
): ChildListsToRead {
    if (entry.childListsToRead !== undefined) {
        return new Set(entry.childListsToRead);
    }

    const childLists: ChildListsToRead = new Set();
    if (entry.action === null) return childLists;

    for (const field of getChildListFields(entry.action.type)) {
        const prop = field.prop as ChildListName;
        if ((entry.childListSummaries?.[prop] ?? []).length > 0) {
            childLists.add(prop);
        }
    }
    return childLists;
}

function shallowChildListOwnerCost(
    observed: ObservedActionSlot,
    desired: DesiredActionEntry
): number {
    if (observed.action === null || observed.action.type !== desired.action.type) {
        return Number.POSITIVE_INFINITY;
    }

    const actionType = observed.action.type;
    const loreFields = getActionLoreFields(actionType);
    let cost = Math.abs(observed.index - desired.index) * INDEX_DISTANCE_WEIGHT;

    for (const label in loreFields) {
        const field = loreFields[label];
        if (field.kind === "childList") {
            const prop = field.prop as ChildListName;
            const observedTypes = observed.childListSummaries?.[prop] ?? [];
            const desiredTypes = desiredChildListTypes(desired.action, prop);
            cost +=
                sequenceTypeCost(observedTypes, desiredTypes) * CHILD_LIST_COST_WEIGHT;
            continue;
        }

        if (
            JSON.stringify((observed.action as Record<string, unknown>)[field.prop]) !==
            JSON.stringify((desired.action as Record<string, unknown>)[field.prop])
        ) {
            cost += SCALAR_FIELD_COST_WEIGHT;
        }
    }

    if (observed.action.note !== desired.action.note) {
        cost += NOTE_COST_WEIGHT;
    }

    return cost;
}

function sequenceTypeCost(
    observed: readonly string[],
    desired: readonly string[]
): number {
    let cost = Math.abs(observed.length - desired.length);
    const shared = Math.min(observed.length, desired.length);
    for (let i = 0; i < shared; i++) {
        if (observed[i] !== desired[i]) cost += 1;
    }
    return cost;
}

export function desiredChildListTypes(action: Action, prop: ChildListName): string[] {
    const value = (action as Record<string, unknown>)[prop];
    if (!Array.isArray(value)) return [];
    if (prop === "conditions") {
        return (value as Condition[]).map((condition) => condition.type);
    }
    return (value as Action[]).map((childAction) => childAction.type);
}
