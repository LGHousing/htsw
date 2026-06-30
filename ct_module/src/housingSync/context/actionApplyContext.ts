import type { Action, Condition } from "htsw/types";

import TaskContext from "../../tasks/context";
import type { ImportSession } from "../../importables/imports";
import type { ItemRegistry } from "../../importables/itemRegistry";
import type {
    Observed,
    ObservedActionSlot,
    ChildListDiff,
} from "../types";
import type {
    ActionPath,
    ImportEventHandler,
    ProgressScope,
} from "../importEvents";
import { childListPath } from "../importEvents";
import type { ProgressHandler } from "../progress/types";
import {
    estimateActionListPhaseUnits,
    estimateConditionListPhaseUnits,
    phaseUnitsTotal,
} from "../progress/costs";

type ChildActionApplyArgs = {
    desired: Action[];
    observed?: ReadonlyArray<Observed<Action> | null>;
    offset?: number;
};

type ConditionApplyArgs = {
    desired: Condition[];
    observed?: ReadonlyArray<Condition | null>;
    offset?: number;
};

export type ActionApplyContext = {
    markHeaderApplied(): void;
    shouldApplyList(prop: string): boolean;
    applyChildActions(prop: string, args: ChildActionApplyArgs): Promise<void>;
    applyConditions(prop: string, args: ConditionApplyArgs): Promise<void>;
};

export type ApplyChildActionList = (
    ctx: TaskContext,
    desired: Action[],
    options: {
        observed?: ObservedActionSlot[];
        session: ImportSession;
        listPath?: ActionPath;
        baselineCurrent?: readonly Action[];
        progressScope?: ProgressScope;
    }
) => Promise<unknown>;

type ApplyConditionList = (
    ctx: TaskContext,
    desired: Condition[],
    options: {
        itemRegistry: ItemRegistry;
        baselineCurrent?: ReadonlyArray<Condition | null>;
        progress?: ProgressHandler;
    }
) => Promise<unknown>;

export type CreateActionApplyContextArgs = {
    ctx: TaskContext;
    actionPath: ActionPath;
    session: ImportSession;
    appliedUnits: number;
    completedOps: number;
    totalOps: number;
    childListDiffs?: readonly ChildListDiff[];
    applyChildActions: ApplyChildActionList;
    applyConditions: ApplyConditionList;
};

function observedActionsAsBaselineCurrent(
    observed: ReadonlyArray<Observed<Action> | null> | undefined
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
): (path: ActionPath, extraOffset?: number) => ProgressScope {
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
    events: ImportEventHandler | undefined,
    scope: ProgressScope | undefined
): ProgressHandler | undefined {
    if (events === undefined || scope === undefined) return undefined;
    return (progress) => events.emit({ kind: "progress", scope, progress });
}

export function createActionApplyContext({
    ctx,
    actionPath,
    session,
    appliedUnits,
    completedOps,
    totalOps,
    childListDiffs,
    applyChildActions,
    applyConditions: applyConditionList,
}: CreateActionApplyContextArgs): ActionApplyContext {
    const events = session.events;
    const scopeAt = childListScope(appliedUnits, completedOps, totalOps);
    const pathForChildList = (prop: string): ActionPath => childListPath(actionPath, prop);
    const listsToApply = childListDiffs === undefined
        ? null
        : new Set(childListDiffs.map((diff) => diff.prop));
    let nextOffset = 0;

    return {
        markHeaderApplied() {
            events?.emit({ kind: "blockActionHeaderApplied", path: actionPath });
        },

        shouldApplyList(prop) {
            return listsToApply === null || listsToApply.has(prop as ChildListDiff["prop"]);
        },

        async applyChildActions(prop, args) {
            const path = pathForChildList(prop);
            const baselineCurrent = observedActionsAsBaselineCurrent(args.observed);
            const offset = args.offset ?? nextOffset;
            await applyChildActions(ctx, args.desired, {
                session,
                listPath: path,
                baselineCurrent,
                progressScope: scopeAt(path, offset),
            });
            nextOffset = offset + phaseUnitsTotal(
                estimateActionListPhaseUnits(args.desired, baselineCurrent)
            );
        },

        async applyConditions(prop, args) {
            const path = pathForChildList(prop);
            const offset = args.offset ?? nextOffset;
            await applyConditionList(ctx, args.desired, {
                itemRegistry: session.items,
                baselineCurrent: args.observed,
                progress: progressFromScope(events, scopeAt(path, offset)),
            });
            nextOffset = offset + phaseUnitsTotal(
                estimateConditionListPhaseUnits(args.desired, args.observed)
            );
        },
    };
}
