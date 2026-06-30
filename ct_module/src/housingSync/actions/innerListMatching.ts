import type { Action, Condition } from "htsw/types";

import { getActionLoreFields, getInnerListFields } from "../fields/actionMappings";
import type {
    InnerListName,
    InnerListHydrationPlan,
    InnerListsToRead,
    ObservedActionSlot,
} from "../types";

const INNER_LIST_COST_WEIGHT = 20;
const SCALAR_FIELD_COST_WEIGHT = 2;
const NOTE_COST_WEIGHT = 1;
const INDEX_DISTANCE_WEIGHT = 1;

export type DesiredActionEntry = {
    index: number;
    action: Action;
};

export function createInnerListHydrationPlan(
    matches: Map<ObservedActionSlot, DesiredActionEntry>
): InnerListHydrationPlan {
    const plan: InnerListHydrationPlan = new Map();
    for (const observed of matches.keys()) {
        plan.set(observed, getInnerListsNeedingHydration(observed));
    }
    return plan;
}

/**
 * Pair each observed inner-list-bearing action with the desired action it
 * most likely represents. Both the hydration plan and trust application read
 * this same pairing, so they always agree on which observed action lines up
 * with which desired one; if they paired independently they could disagree.
 *
 * Only considers observed entries that still have inner lists to read (the
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
        if (getInnerListFields(type).length === 0) continue;

        const observedBucket = observed.filter(
            (entry) =>
                entry.action !== null &&
                entry.action.type === type &&
                getInnerListsNeedingHydration(entry).size > 0
        );
        if (observedBucket.length === 0) continue;

        const candidates: Candidate[] = [];
        for (const desiredEntry of desiredBucket) {
            for (const observedEntry of observedBucket) {
                candidates.push({
                    observed: observedEntry,
                    desired: desiredEntry,
                    cost: shallowInnerListOwnerCost(observedEntry, desiredEntry),
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

export function getInnerListsNeedingHydration(
    entry: ObservedActionSlot
): InnerListsToRead {
    if (entry.innerListsToRead !== undefined) {
        return new Set(entry.innerListsToRead);
    }

    const innerLists: InnerListsToRead = new Set();
    if (entry.action === null) return innerLists;

    for (const field of getInnerListFields(entry.action.type)) {
        const prop = field.prop as InnerListName;
        if ((entry.innerListSummaries?.[prop] ?? []).length > 0) {
            innerLists.add(prop);
        }
    }
    return innerLists;
}

function shallowInnerListOwnerCost(
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
        if (field.kind === "innerList") {
            const prop = field.prop as InnerListName;
            const observedTypes = observed.innerListSummaries?.[prop] ?? [];
            const desiredTypes = desiredInnerListTypes(desired.action, prop);
            cost +=
                sequenceTypeCost(observedTypes, desiredTypes) * INNER_LIST_COST_WEIGHT;
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

export function desiredInnerListTypes(action: Action, prop: InnerListName): string[] {
    const value = (action as Record<string, unknown>)[prop];
    if (!Array.isArray(value)) return [];
    if (prop === "conditions") {
        return (value as Condition[]).map((condition) => condition.type);
    }
    return (value as Action[]).map((innerAction) => innerAction.type);
}
