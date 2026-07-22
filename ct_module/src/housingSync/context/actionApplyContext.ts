import type { Action, Condition } from "htsw/types";

import TaskContext from "../../tasks/context";
import type { ActionSyncContext } from "../actions/syncContext";
import type { ResolveItemField } from "../items/itemReferences";
import type { ChildListDiff } from "../actions/diff/types";
import type { Observed, ObservedActionSlot } from "../observedActions";
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
    estimateActionListPhaseUnits,
    estimateConditionListPhaseUnits,
} from "../progress/costs";

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
    desired: Action[],
    options: {
        observed?: ObservedActionSlot[];
        sync: ActionSyncContext;
        listPath?: ActionListPath;
        baselineCurrent?: readonly Action[];
        progressScope?: ProgressScope;
    }
) => Promise<unknown>;

type ApplyConditionList = (
    ctx: TaskContext,
    desired: Condition[],
    options: {
        resolveItem: ResolveItemField;
        baselineCurrent?: ReadonlyArray<Condition | null>;
        progress?: ProgressHandler;
        itemDiff?: import("../actions/diff/itemDiffContext").ItemDiffContext;
    }
) => Promise<unknown>;

export type CreateActionApplyContextArgs = {
    ctx: TaskContext;
    actionPath: ActionPath;
    sync: ActionSyncContext;
    appliedUnits: number;
    completedOps: number;
    totalOps: number;
    childListDiffs?: readonly ChildListDiff[];
    applyChildActions: ApplyChildActionList;
    applyConditions: ApplyConditionList;
};

function observedActionsAsBaselineCurrent(
    observed: ReadonlyArray<Observed | null> | undefined
): readonly Action[] | undefined {
    if (observed === undefined) return undefined;
    const out: Action[] = [];
    for (const entry of observed) {
        if (entry !== null) out.push(entry as Action);
    }
    return out;
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
    const listsToApply =
        childListDiffs === undefined
            ? null
            : new Set(childListDiffs.map((diff) => diff.prop));
    let nextOffset = 0;

    return {
        markHeaderApplied() {
            events?.emit({ kind: "blockActionHeaderApplied", path: actionPath });
        },

        shouldApplyList(prop) {
            return listsToApply === null || listsToApply.has(prop);
        },

        async applyChildActions(prop, args) {
            const path = ActionListPath.childOf(actionPath, prop);
            const baselineCurrent = observedActionsAsBaselineCurrent(args.observed);
            const offset = args.offset ?? nextOffset;
            await applyChildActions(ctx, args.desired, {
                sync,
                listPath: path,
                baselineCurrent,
                progressScope: scopeAt(path, offset),
            });
            nextOffset =
                offset +
                estimateActionListPhaseUnits(args.desired, baselineCurrent).applying;
        },

        async applyConditions(prop, args) {
            const path = ConditionListPath.of(actionPath, prop);
            const offset = args.offset ?? nextOffset;
            await applyConditionList(ctx, args.desired, {
                resolveItem: sync.resolveItem,
                baselineCurrent: args.observed,
                progress: progressFromScope(events, scopeAt(path, offset)),
                itemDiff: sync.itemDiff,
            });
            nextOffset =
                offset +
                estimateConditionListPhaseUnits(args.desired, args.observed).applying;
        },
    };
}
