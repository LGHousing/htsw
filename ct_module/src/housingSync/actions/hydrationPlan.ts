import type { NestedHydrationPlan, ObservedActionSlot } from "../types";
import { type DesiredActionEntry, getPropsNeedingHydration } from "./nestedMatching";

/**
 * Turn observed→desired matches into the hydration plan: one entry per
 * matched observed slot, with the props that still need to be read by
 * clicking into the action editor. Trust application may later subtract
 * props (or whole entries) when the cache says the nested list hasn't
 * drifted.
 */
export function createNestedHydrationPlan(
    matches: Map<ObservedActionSlot, DesiredActionEntry>
): NestedHydrationPlan {
    const plan: NestedHydrationPlan = new Map();
    for (const observed of matches.keys()) {
        plan.set(observed, getPropsNeedingHydration(observed));
    }
    return plan;
}
