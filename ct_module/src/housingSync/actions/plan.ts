import type { Action } from "htsw/types";

import TaskContext from "../../tasks/context";
import type { ImportSession } from "../../importables/imports";
import type {
    ActionListDiff,
    ActionListTrust,
    ObservedActionSlot,
} from "../types";
import type { PhaseUnits, ProgressHandler } from "../progress/types";
import {
    baselineActionListFromActions,
    baselineActionListFromSlots,
    diffActionList,
} from "./diff";
import { canonicalizeActionItemName, readActionList } from "./readList";
import { getInnerListFields } from "../fields/actionMappings";
import {
    actionListDiffApplyUnits,
    editUnitsWithInnerLists,
    estimateActionListPhaseUnits,
    phaseUnitsTotal,
} from "../progress/costs";
import type { ProgressScope } from "../importEvents";
import type { ActionPath } from "../importEvents";

export type ActionListApplyOptions = {
    session: ImportSession;
    listPath?: ActionPath;
    progressScope?: ProgressScope;
};

export type ActionListPrereadOptions = ActionListApplyOptions & {
    trust?: ActionListTrust;
    baselineCurrent?: readonly Action[];
};

export type ActionListPlan = {
    readonly desired: Action[];
    readonly observed: ObservedActionSlot[];
    readonly diff: ActionListDiff;
    readonly phaseUnits: Readonly<PhaseUnits>;
};

export async function prereadActionList(
    ctx: TaskContext,
    desired: Action[],
    options: ActionListPrereadOptions
): Promise<ActionListPlan> {
    const phaseUnits = estimateActionListPhaseUnits(
        desired,
        options.baselineCurrent
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
    const observed = await readActionList(ctx,
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
    );
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
        editUnitsWithInnerLists,
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

export function createKnownEmptyActionListPlan(
    desired: Action[],
    options: ActionListApplyOptions
): ActionListPlan {
    for (const action of desired) {
        canonicalizeActionItemName(action, options.session.items);
    }
    const phaseUnits = estimateActionListPhaseUnits(desired, []);
    const diff = diffActionList(baselineActionListFromActions([]), desired);
    phaseUnits.applying = Math.max(
        actionListDiffApplyUnits(diff, editUnitsWithInnerLists, desired.length),
        1
    );
    return { desired, observed: [], diff, phaseUnits };
}

/**
 * Whether a current snapshot is fully read: no null slots and
 * every inner list (conditions / inner action bodies) hydrated. A shallow
 * snapshot holds nulls for un-read inner lists; persisting one would cache a
 * half-known list as truth.
 */
export function actionsFullyHydrated(actions: ReadonlyArray<Action | null>): boolean {
    for (const action of actions) {
        if (action === null) return false;
        for (const field of getInnerListFields(action.type)) {
            const inner = (action as Record<string, unknown>)[field.prop];
            if (!Array.isArray(inner)) continue;
            if (field.prop === "conditions") {
                for (const condition of inner) {
                    if (condition === null) return false;
                }
            } else if (!actionsFullyHydrated(inner as Array<Action | null>)) {
                return false;
            }
        }
    }
    return true;
}
