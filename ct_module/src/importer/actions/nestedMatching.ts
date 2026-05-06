import type { Action, Condition } from "htsw/types";

import { getActionLoreFields, getNestedListFields } from "../actionMappings";
import type {
    NestedListProp,
    NestedPropsToRead,
    ObservedActionSlot,
} from "../types";

const NESTED_LIST_COST_WEIGHT = 20;
const SCALAR_FIELD_COST_WEIGHT = 2;
const NOTE_COST_WEIGHT = 1;
const INDEX_DISTANCE_WEIGHT = 1;

export type DesiredActionEntry = {
    index: number;
    action: Action;
};

/**
 * Pair each observed nested-list-bearing action with the desired action it
 * most likely represents. Shared between hydration plan creation and trust
 * application so both consumers see the same pairing — a previous version
 * ran two independent matching passes that could disagree, causing trust
 * to no-op on entries hydration had already matched correctly.
 *
 * Restricted to observed entries with `getPropsNeedingHydration > 0`: the
 * downstream consumers both key off the hydration plan, which only contains
 * those entries. Filtering here avoids enumerating candidate pairs that
 * neither consumer would act on.
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
        if (getNestedListFields(type).length === 0) continue;

        const observedBucket = observed.filter(
            (entry) =>
                entry.action !== null &&
                entry.action.type === type &&
                getPropsNeedingHydration(entry).size > 0
        );
        if (observedBucket.length === 0) continue;

        const candidates: Candidate[] = [];
        for (const desiredEntry of desiredBucket) {
            for (const observedEntry of observedBucket) {
                candidates.push({
                    observed: observedEntry,
                    desired: desiredEntry,
                    cost: shallowNestedActionCost(observedEntry, desiredEntry),
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

export function getPropsNeedingHydration(
    entry: ObservedActionSlot
): NestedPropsToRead {
    if (entry.nestedPropsToRead !== undefined) {
        return new Set(entry.nestedPropsToRead);
    }

    const props: NestedPropsToRead = new Set();
    if (entry.action === null) return props;

    for (const field of getNestedListFields(entry.action.type)) {
        const prop = field.prop as NestedListProp;
        if ((entry.nestedSummaries?.[prop] ?? []).length > 0) {
            props.add(prop);
        }
    }
    return props;
}

function shallowNestedActionCost(
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
        if (field.kind === "nestedList") {
            const prop = field.prop as NestedListProp;
            const observedTypes = observed.nestedSummaries?.[prop] ?? [];
            const desiredTypes = desiredNestedTypes(desired.action, prop);
            cost +=
                sequenceTypeCost(observedTypes, desiredTypes) * NESTED_LIST_COST_WEIGHT;
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

function desiredNestedTypes(action: Action, prop: NestedListProp): string[] {
    const value = (action as Record<string, unknown>)[prop];
    if (!Array.isArray(value)) return [];
    if (prop === "conditions") {
        return (value as Condition[]).map((condition) => condition.type);
    }
    return (value as Action[]).map((nestedAction) => nestedAction.type);
}
