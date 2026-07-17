import type { Action, Condition } from "htsw/types";

import type { ChildListName } from "../actionPath";
import type { ObservedActionSlot } from "../observedActions";
import { presentChildListsContainNoNulls } from "../observedActions";
import { desiredChildListTypes, type DesiredActionEntry } from "./diff/childListMatching";
import type { ActionHydrationPlan } from "./hydration/plan";
import { actionHydrationWorkRequiresHousing } from "./hydration/plan";

export type TrustedChildListPath = string;

export type TrustedChildListSnapshot =
    | {
          kind: "actions";
          actions: readonly Action[];
      }
    | {
          kind: "conditions";
          conditions: readonly Condition[];
      };

export type ActionListTrust = {
    basePath: string;
    trustedChildListPaths: ReadonlySet<TrustedChildListPath>;
    trustedChildLists: ReadonlyMap<TrustedChildListPath, TrustedChildListSnapshot>;
};

/**
 * Consumes the same matches as `createActionHydrationPlan` so trust never
 * disagrees with hydration about which observed corresponds to which desired.
 */
export function applyActionListTrust(
    matches: Map<ObservedActionSlot, DesiredActionEntry>,
    plan: ActionHydrationPlan,
    trust: ActionListTrust
): void {
    if (trust.trustedChildListPaths.size === 0) return;

    for (const [observed, desired] of matches) {
        const work = plan.get(observed);
        if (work === undefined || observed.action === null) continue;

        for (const prop of Array.from(work.childListsToRead)) {
            const path = `${trust.basePath}[${desired.index}].${prop}`;
            if (!trust.trustedChildListPaths.has(path)) continue;
            const snapshot = trust.trustedChildLists.get(path);
            if (snapshot === undefined) continue;
            if (!shallowChildListShapeMatches(observed, desired, prop)) continue;

            applyTrustedSnapshot(observed, prop, snapshot);
            work.childListsToRead.delete(prop);
        }

        if (!actionHydrationWorkRequiresHousing(work)) {
            plan.delete(observed);
            observed.hydrated = presentChildListsContainNoNulls(observed.action);
        }
    }
}

function applyTrustedSnapshot(
    observed: ObservedActionSlot,
    prop: ChildListName,
    snapshot: TrustedChildListSnapshot
): void {
    if (observed.action === null) return;
    if (prop === "conditions") {
        if (snapshot.kind !== "conditions") return;
        Object.assign(observed.action, { [prop]: cloneConditions(snapshot.conditions) });
        return;
    }
    if (snapshot.kind !== "actions") return;
    Object.assign(observed.action, { [prop]: cloneActions(snapshot.actions) });
}

function cloneActions(actions: readonly Action[]): Action[] {
    return JSON.parse(JSON.stringify(actions)) as Action[];
}

function cloneConditions(conditions: readonly Condition[]): Condition[] {
    return JSON.parse(JSON.stringify(conditions)) as Condition[];
}

function shallowChildListShapeMatches(
    observed: ObservedActionSlot,
    desired: DesiredActionEntry,
    prop: ChildListName
): boolean {
    const observedTypes = observed.childListSummaries?.[prop] ?? [];
    const desiredTypes = desiredChildListTypes(desired.action, prop);
    if (observedTypes.length !== desiredTypes.length) return false;
    for (let i = 0; i < observedTypes.length; i++) {
        if (observedTypes[i] !== desiredTypes[i]) return false;
    }
    return true;
}
