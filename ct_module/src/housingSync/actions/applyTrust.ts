import type {
    ActionListTrust,
    NestedHydrationPlan,
    ObservedActionSlot,
} from "../types";
import type { DesiredActionEntry } from "./nestedMatching";

/**
 * For each matched (observed, desired) pair, copy desired's nested list onto
 * observed for any prop whose path is in `trust.trustedListPaths`, and remove
 * it from the hydration plan so the action editor never gets opened for that
 * list. Mutates `plan` and the observed entries in place.
 *
 * Consumes the same matches as `createNestedHydrationPlan` so trust never
 * disagrees with hydration about which observed corresponds to which desired.
 */
export function applyActionListTrust(
    matches: Map<ObservedActionSlot, DesiredActionEntry>,
    plan: NestedHydrationPlan,
    trust: ActionListTrust
): void {
    if (trust.trustedListPaths.size === 0) return;

    for (const [observed, desired] of matches) {
        const propsToRead = plan.get(observed);
        if (propsToRead === undefined || observed.action === null) continue;

        let trustedAny = false;
        for (const prop of Array.from(propsToRead)) {
            const path = `${trust.basePath}[${desired.index}].${prop}`;
            if (!trust.trustedListPaths.has(path)) continue;

            const desiredValue = (desired.action as Record<string, unknown>)[prop];
            if (!Array.isArray(desiredValue)) continue;

            Object.assign(observed.action, { [prop]: desiredValue });
            propsToRead.delete(prop);
            trustedAny = true;
        }

        if (propsToRead.size === 0) {
            plan.delete(observed);
            if (trustedAny) observed.nestedReadState = "trusted";
        } else if (trustedAny) {
            observed.nestedReadState = "trusted";
        }
    }
}
