import type { Action, Condition } from "htsw/types";

import { getActionLoreFields, getNestedListFields } from "../actionMappings";
import type {
    ActionListTrust,
    NestedHydrationPlan,
    NestedListProp,
    ObservedActionSlot,
} from "../types";

const NESTED_LIST_COST_WEIGHT = 20;
const SCALAR_FIELD_COST_WEIGHT = 2;
const NOTE_COST_WEIGHT = 1;
const INDEX_DISTANCE_WEIGHT = 1;

type DesiredActionEntry = {
    index: number;
    action: Action;
};

type TrustCandidate = {
    observed: ObservedActionSlot;
    desired: DesiredActionEntry;
    cost: number;
};

export function applyActionListTrust(
    observed: readonly ObservedActionSlot[],
    desired: readonly Action[],
    plan: NestedHydrationPlan,
    trust: ActionListTrust
): void {
    if (trust.trustedListPaths.size === 0) return;

    const matches = matchTrustedActions(observed, desired);
    for (const match of matches) {
        const propsToRead = plan.get(match.observed);
        if (propsToRead === undefined || match.observed.action === null) {
            continue;
        }

        let trustedAny = false;
        for (const prop of Array.from(propsToRead)) {
            const path = `${trust.basePath}[${match.desired.index}].${prop}`;
            if (!trust.trustedListPaths.has(path)) {
                continue;
            }

            const desiredValue = (match.desired.action as Record<string, unknown>)[prop];
            if (!Array.isArray(desiredValue)) {
                continue;
            }

            Object.assign(match.observed.action, { [prop]: desiredValue });
            propsToRead.delete(prop);
            trustedAny = true;
        }

        if (propsToRead.size === 0) {
            plan.delete(match.observed);
            if (trustedAny) {
                match.observed.nestedReadState = "trusted";
            }
        } else if (trustedAny) {
            match.observed.nestedReadState = "trusted";
        }
    }
}

function matchTrustedActions(
    observed: readonly ObservedActionSlot[],
    desired: readonly Action[]
): TrustCandidate[] {
    const candidates: TrustCandidate[] = [];
    const desiredEntries: DesiredActionEntry[] = desired.map((action, index) => ({
        action,
        index,
    }));

    for (const observedEntry of observed) {
        if (
            observedEntry.action === null ||
            getNestedListFields(observedEntry.action.type).length === 0
        ) {
            continue;
        }
        for (const desiredEntry of desiredEntries) {
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

    const matched: TrustCandidate[] = [];
    const usedObserved = new Set<ObservedActionSlot>();
    const usedDesired = new Set<number>();
    for (const candidate of candidates) {
        if (!isFinite(candidate.cost)) continue;
        if (
            usedObserved.has(candidate.observed) ||
            usedDesired.has(candidate.desired.index)
        ) {
            continue;
        }

        usedObserved.add(candidate.observed);
        usedDesired.add(candidate.desired.index);
        matched.push(candidate);
    }
    return matched;
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
        if (observed[i] !== desired[i]) {
            cost += 1;
        }
    }

    return cost;
}

function desiredNestedTypes(action: Action, prop: NestedListProp): string[] {
    const value = (action as Record<string, unknown>)[prop];
    if (!Array.isArray(value)) {
        return [];
    }

    if (prop === "conditions") {
        return (value as Condition[]).map((condition) => condition.type);
    }

    return (value as Action[]).map((nestedAction) => nestedAction.type);
}
