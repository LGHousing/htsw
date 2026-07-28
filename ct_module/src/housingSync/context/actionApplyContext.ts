import type { Action, Condition } from "htsw/types";

import TaskContext from "../../tasks/context";
import type { ActionSyncContext } from "../actions/syncContext";
import type {
    ChildAction,
    ChildActionListDiff,
    ChildListDiff,
    ConditionListDiff,
} from "../actions/diff/types";
import { isChildAction } from "../actions/childActions";
import type { Observed } from "../observedActions";
import type { SyncEventHandler, ProgressScope } from "../syncEvents";
import {
    ActionListPath,
    type ActionPath,
    type ChildActionListName,
    type ChildConditionListName,
    type ChildListName,
    type NestedListPath,
    ConditionListPath,
} from "../actionPath";
import type { ProgressHandler } from "../progress/types";
import {
    childActionListDiffApplyUnits,
    conditionListDiffApplyUnits,
} from "../progress/costs";
import type { PlannedChildActionList } from "../actions/apply/types";
import type { ApplyPlannedConditionListOptions } from "../actions/conditions/apply";

type ChildActionApplyArgs = {
    desired: Action[];
    observed?: ReadonlyArray<Observed | null>;
    offset?: number;
};

type ConditionApplyArgs = {
    desired: Condition[];
    observed?: ReadonlyArray<Condition | null>;
    offset?: number;
};

export type ActionApplyContext = {
    markHeaderApplied(): void;
    shouldApplyList(prop: ChildListName): boolean;
    applyChildActions(
        prop: ChildActionListName,
        args: ChildActionApplyArgs
    ): Promise<void>;
    applyConditions(
        prop: ChildConditionListName,
        args: ConditionApplyArgs
    ): Promise<void>;
};

type ApplyChildActionList = (
    ctx: TaskContext,
    plan: PlannedChildActionList,
    options: {
        sync: ActionSyncContext;
        listPath: ActionListPath;
        progressScope: ProgressScope;
    }
) => Promise<unknown>;

type ApplyConditionList = (
    ctx: TaskContext,
    observedCount: number,
    diff: ConditionListDiff,
    options: ApplyPlannedConditionListOptions
) => Promise<unknown>;

export type CreateActionApplyContextArgs = {
    ctx: TaskContext;
    actionPath: ActionPath;
    sync: ActionSyncContext;
    appliedUnits: number;
    completedOps: number;
    totalOps: number;
    childListDiffs: readonly ChildListDiff[];
    applyChildActions: ApplyChildActionList;
    applyConditions: ApplyConditionList;
};

function childActionListDiffFor(
    childListDiffs: readonly ChildListDiff[],
    prop: ChildActionListName
): ChildActionListDiff {
    const childList = plannedChildListDiffFor(childListDiffs, prop);
    if (childList.kind !== "actions") {
        throw new Error(`Planned child list "${prop}" is not an action list.`);
    }
    return childList.diff;
}

function conditionListDiffFor(
    childListDiffs: readonly ChildListDiff[],
    prop: ChildConditionListName
): ConditionListDiff {
    const childList = plannedChildListDiffFor(childListDiffs, prop);
    if (childList.kind !== "conditions") {
        throw new Error(`Planned child list "${prop}" is not a condition list.`);
    }
    return childList.diff;
}

function plannedChildListDiffFor(
    childListDiffs: readonly ChildListDiff[],
    prop: ChildListName
): ChildListDiff {
    for (const childList of childListDiffs) {
        if (childList.prop === prop) return childList;
    }
    throw new Error(`No planned child-list diff for "${prop}".`);
}

function checkedChildActions(actions: readonly Action[]): ChildAction[] {
    for (const action of actions) {
        if (!isChildAction(action)) {
            throw new Error(
                `${action.type} action cannot appear inside an action child list.`
            );
        }
    }
    return actions as ChildAction[];
}

function checkedObservedChildActions(
    actions: ReadonlyArray<Observed | null> | undefined
): ReadonlyArray<Observed<ChildAction> | null> {
    if (actions === undefined) return [];
    for (const action of actions) {
        if (action !== null && !isChildAction(action)) {
            throw new Error(
                `${action.type} action cannot appear inside an action child list.`
            );
        }
    }
    return actions as ReadonlyArray<Observed<ChildAction> | null>;
}

function childListScope(
    baselineApplyUnits: number,
    completedOps: number,
    totalOps: number
): (path: NestedListPath, extraOffset?: number) => ProgressScope {
    return (path, extraOffset) => ({
        kind: "childList",
        path,
        baselineApplyUnits: baselineApplyUnits + (extraOffset ?? 0),
        parentSync: {
            completedUnits: completedOps,
            totalUnits: totalOps,
        },
    });
}

function progressFromScope(
    events: SyncEventHandler | undefined,
    scope: ProgressScope | undefined
): ProgressHandler | undefined {
    if (events === undefined || scope === undefined) return undefined;
    return (progress) => events.emit({ kind: "progress", scope, progress });
}

export function createActionApplyContext({
    ctx,
    actionPath,
    sync,
    appliedUnits,
    completedOps,
    totalOps,
    childListDiffs,
    applyChildActions,
    applyConditions: applyConditionList,
}: CreateActionApplyContextArgs): ActionApplyContext {
    const events = sync.events;
    const scopeAt = childListScope(appliedUnits, completedOps, totalOps);
    const listsToApply = new Set(childListDiffs.map((diff) => diff.prop));
    let nextOffset = 0;

    return {
        markHeaderApplied() {
            events?.emit({ kind: "blockActionHeaderApplied", path: actionPath });
        },

        shouldApplyList(prop) {
            return listsToApply.has(prop);
        },

        async applyChildActions(prop, args) {
            const path = ActionListPath.childOf(actionPath, prop);
            const diff = childActionListDiffFor(childListDiffs, prop);
            const offset = args.offset ?? nextOffset;
            await applyChildActions(
                ctx,
                {
                    desired: checkedChildActions(args.desired),
                    observed: checkedObservedChildActions(args.observed),
                    diff,
                },
                {
                    sync,
                    listPath: path,
                    progressScope: scopeAt(path, offset),
                }
            );
            nextOffset = offset + childActionListDiffApplyUnits(diff);
        },

        async applyConditions(prop, args) {
            const path = ConditionListPath.of(actionPath, prop);
            const diff = conditionListDiffFor(childListDiffs, prop);
            const offset = args.offset ?? nextOffset;
            await applyConditionList(ctx, args.observed?.length ?? 0, diff, {
                resolveItem: sync.resolveItem,
                progress: progressFromScope(events, scopeAt(path, offset)),
            });
            nextOffset = offset + conditionListDiffApplyUnits(diff);
        },
    };
}
