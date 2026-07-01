import type { Action } from "htsw/types";

import TaskContext from "../../tasks/context";
import type { ImportSession } from "../../importables/imports";
import type {
    ActionListDiff,
    ActionListTrust,
    ObservedActionSlot,
} from "../types";
import type { PhaseUnits, ProgressHandler } from "../progress/types";
import { baselineActionListFromSlots, diffActionList } from "./diff";
import { canonicalizeActionItemName, readActionList } from "./readList";
import { getNestedListFields } from "../fields/actionMappings";
import {
    actionListDiffApplyUnits,
    editUnitsWithNested,
    estimateActionListPhaseUnits,
    phaseUnitsTotal,
} from "../progress/costs";
import type { ProgressScope } from "../syncEvents";
import type { ActionPath } from "../syncEvents";

export type ActionListApplyOptions = {
    session: ImportSession;
    listPath?: ActionPath;
    progressScope?: ProgressScope;
};

export type ActionListPrereadOptions = ActionListApplyOptions & {
    observed?: ObservedActionSlot[];
    trust?: ActionListTrust;
    baselineCurrent?: readonly Action[];
};

export type ActionListPlan = {
    desired: Action[];
    observed: ObservedActionSlot[];
    diff: ActionListDiff;
    phaseUnits: PhaseUnits;
    getLiveCurrent?: () => Array<Action | null>;
};

export async function prereadActionList(
    ctx: TaskContext,
    desired: Action[],
    options: ActionListPrereadOptions
): Promise<ActionListPlan> {
    const phaseUnits = estimateActionListPhaseUnits(
        desired,
        options.observed === undefined ? options.baselineCurrent : undefined
    );
    const progressScope: ProgressScope = options.progressScope ?? { kind: "topLevel" };
    const progress: ProgressHandler | undefined =
        options.session.events === undefined
            ? undefined
            : (event) => options.session.events?.emit({
                  kind: "progress",
                  scope: progressScope,
                  progress: event,
              });
    const observed =
        options.observed ??
        (await readActionList(ctx,
            {
                kind: "sync",
                desired,
                trust: options.trust,
            },
            {
                itemRegistry: options.session.items,
                progress,
                phaseUnits,
                listPath: options.listPath,
                events: options.session.events,
                itemCaptures: options.session.itemCaptures,
            }
        ));
    for (const entry of observed) {
        if (entry.action !== null) {
            canonicalizeActionItemName(entry.action, options.session.items);
        }
    }
    for (const action of desired) {
        canonicalizeActionItemName(action, options.session.items);
    }
    const diff = diffActionList(baselineActionListFromSlots(observed), desired);
    const exactApplyUnits = actionListDiffApplyUnits(
        diff,
        editUnitsWithNested,
        desired.length
    );
    phaseUnits.applying = Math.max(exactApplyUnits, 1);
    progress?.({
        phase: "hydrating",
        completedUnits: phaseUnits.reading + phaseUnits.hydrating,
        totalUnits: phaseUnitsTotal(phaseUnits),
        phaseUnits,
        sync: { completedUnits: 1, totalUnits: 1, parent: null },
    });

    return { desired, observed, diff, phaseUnits };
}

/**
 * Whether a live snapshot from `getLiveCurrent` is fully read: no null slots and
 * every nested list (conditions / nested action bodies) hydrated. A shallow
 * snapshot holds nulls for un-read nested lists; persisting one would cache a
 * half-known list as truth.
 */
export function actionsFullyHydrated(actions: ReadonlyArray<Action | null>): boolean {
    for (const action of actions) {
        if (action === null) return false;
        for (const field of getNestedListFields(action.type)) {
            const nested = (action as Record<string, unknown>)[field.prop];
            if (!Array.isArray(nested)) continue;
            if (field.prop === "conditions") {
                for (const condition of nested) {
                    if (condition === null) return false;
                }
            } else if (!actionsFullyHydrated(nested as Array<Action | null>)) {
                return false;
            }
        }
    }
    return true;
}
