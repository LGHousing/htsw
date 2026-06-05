import type { Action, Condition } from "htsw/types";

import TaskContext from "../../tasks/context";
import { type ItemRegistry } from "../../importables/itemRegistry";
import type {
    Observed,
    ObservedActionSlot,
    ObservedConditionSlot,
} from "../types";
import type {
    ActionPath,
    ImportEventHandler,
    ProgressScope,
} from "../importEvents";
import { nestedActionPath } from "../importEvents";
import type { ProgressHandler } from "../progress/types";
import {
    estimateActionListPhaseUnits,
    estimateConditionListPhaseUnits,
    phaseUnitsTotal,
} from "../progress/costs";

export type NestedActionApplyArgs = {
    desired: Action[];
    observed?: ReadonlyArray<Observed<Action> | null>;
    offset?: number;
};

export type NestedConditionApplyArgs = {
    desired: Condition[];
    observed?: ReadonlyArray<Condition | null>;
    offset?: number;
};

export type ActionApplyContext = {
    markHeaderApplied(): void;
    applyNestedActions(prop: string, args: NestedActionApplyArgs): Promise<void>;
    applyNestedConditions(prop: string, args: NestedConditionApplyArgs): Promise<void>;
};

export type ApplyNestedActionList = (
    ctx: TaskContext,
    desired: Action[],
    options: {
        observed?: ObservedActionSlot[];
        itemRegistry?: ItemRegistry;
        pathPrefix?: ActionPath;
        baselineCurrent?: readonly Action[];
        progressScope?: ProgressScope;
        events?: ImportEventHandler;
    }
) => Promise<unknown>;

export type ApplyNestedConditionList = (
    ctx: TaskContext,
    desired: Condition[],
    options: {
        observed?: ObservedConditionSlot[];
        itemRegistry?: ItemRegistry;
        baselineCurrent?: ReadonlyArray<Condition | null>;
        progress?: ProgressHandler;
    }
) => Promise<unknown>;

export type CreateActionApplyContextArgs = {
    ctx: TaskContext;
    actionPath: ActionPath;
    itemRegistry?: ItemRegistry;
    events?: ImportEventHandler;
    appliedUnits: number;
    completedOps: number;
    totalOps: number;
    applyNestedActions: ApplyNestedActionList;
    applyNestedConditions: ApplyNestedConditionList;
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

function reuseObservedActions(
    observed: ReadonlyArray<Observed<Action> | null> | undefined
): ObservedActionSlot[] | undefined {
    if (observed === undefined) return undefined;
    const out: ObservedActionSlot[] = [];
    for (let i = 0; i < observed.length; i++) {
        const action = observed[i];
        if (action === null) return undefined;
        out.push({ index: i, action, nestedReadState: "full" });
    }
    return out;
}

function reuseObservedConditions(
    observed: ReadonlyArray<Condition | null> | undefined
): ObservedConditionSlot[] | undefined {
    if (observed === undefined) return undefined;
    const out: ObservedConditionSlot[] = [];
    for (let i = 0; i < observed.length; i++) {
        const condition = observed[i];
        if (condition === null) return undefined;
        out.push({ index: i, condition });
    }
    return out;
}

function nestedApplyScope(
    parentActionPath: ActionPath,
    baselineApplyUnits: number,
    completedOps: number,
    totalOps: number
): (path: ActionPath, extraOffset?: number) => ProgressScope {
    return (path, extraOffset) => ({
        kind: "nestedActionList",
        path,
        parentActionPath,
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
    itemRegistry,
    events,
    appliedUnits,
    completedOps,
    totalOps,
    applyNestedActions,
    applyNestedConditions,
}: CreateActionApplyContextArgs): ActionApplyContext {
    const scopeAt = nestedApplyScope(actionPath, appliedUnits, completedOps, totalOps);
    const nestedPath = (prop: string): ActionPath => nestedActionPath(actionPath, prop);
    let nextOffset = 0;

    return {
        markHeaderApplied() {
            events?.emit({ kind: "blockActionHeaderApplied", path: actionPath });
        },

        async applyNestedActions(prop, args) {
            const path = nestedPath(prop);
            const baselineCurrent = observedActionsAsBaselineCurrent(args.observed);
            const offset = args.offset ?? nextOffset;
            await applyNestedActions(ctx, args.desired, {
                itemRegistry,
                observed: reuseObservedActions(args.observed),
                pathPrefix: path,
                baselineCurrent,
                progressScope: scopeAt(path, offset),
                events,
            });
            nextOffset = offset + phaseUnitsTotal(
                estimateActionListPhaseUnits(args.desired, baselineCurrent)
            );
        },

        async applyNestedConditions(prop, args) {
            const path = nestedPath(prop);
            const offset = args.offset ?? nextOffset;
            await applyNestedConditions(ctx, args.desired, {
                itemRegistry,
                observed: reuseObservedConditions(args.observed),
                baselineCurrent: args.observed,
                progress: progressFromScope(events, scopeAt(path, offset)),
            });
            nextOffset = offset + phaseUnitsTotal(
                estimateConditionListPhaseUnits(args.desired, args.observed)
            );
        },
    };
}
