import type {
    ActionListTrust,
    InnerListHydrationPlan,
    InnerListName,
    ObservedActionSlot,
} from "../types";
import { desiredInnerListTypes, type DesiredActionEntry } from "./innerListMatching";

/**
 * Consumes the same matches as `createInnerListHydrationPlan` so trust never
 * disagrees with hydration about which observed corresponds to which desired.
 */
export function applyActionListTrust(
    matches: Map<ObservedActionSlot, DesiredActionEntry>,
    plan: InnerListHydrationPlan,
    trust: ActionListTrust
): void {
    if (trust.trustedListPaths.size === 0) return;

    for (const [observed, desired] of matches) {
        const innerListsToRead = plan.get(observed);
        if (innerListsToRead === undefined || observed.action === null) continue;

        for (const prop of Array.from(innerListsToRead)) {
            const path = `${trust.basePath}[${desired.index}].${prop}`;
            if (!trust.trustedListPaths.has(path)) continue;
            if (!shallowInnerListShapeMatches(observed, desired, prop)) continue;

            if (observed.trustedInnerLists === undefined) {
                observed.trustedInnerLists = new Set();
            }
            observed.trustedInnerLists.add(prop);
            innerListsToRead.delete(prop);
        }

        if (innerListsToRead.size === 0) {
            plan.delete(observed);
        }
    }
}

function shallowInnerListShapeMatches(
    observed: ObservedActionSlot,
    desired: DesiredActionEntry,
    prop: InnerListName
): boolean {
    const observedTypes = observed.innerListSummaries?.[prop] ?? [];
    const desiredTypes = desiredInnerListTypes(desired.action, prop);
    if (observedTypes.length !== desiredTypes.length) return false;
    for (let i = 0; i < observedTypes.length; i++) {
        if (observedTypes[i] !== desiredTypes[i]) return false;
    }
    return true;
}
