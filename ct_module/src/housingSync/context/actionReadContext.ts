import type { Action, Condition } from "htsw/types";

import TaskContext from "../../tasks/context";
import type { ItemRegistry } from "../../importables/itemRegistry";
import type { ActionListReadMode } from "../actions/readList";
import type {
    Observed,
    ObservedActionSlot,
    ObservedConditionSlot,
} from "../observedActions";
import type { PhaseUnits, ProgressHandler } from "../progress/types";
import type { ReadConditionListOptions } from "../actions/conditions/readList";
import type { SyncEventHandler } from "../syncEvents";
import {
    ActionListPath,
    type ActionPath,
    type ChildActionListName,
    type ChildConditionListName,
    type ChildListName,
    ConditionListPath,
    type NestedListPath,
} from "../actionPath";
import type { ItemCaptureRegistry } from "../itemCapture";

export type ListReadOptions = {
    itemRegistry?: ItemRegistry;
    itemCaptures?: ItemCaptureRegistry;
    events?: SyncEventHandler;
    listPath?: ActionListPath;
    emitSnapshot?: () => void;
    progress?: ProgressHandler;
    phaseUnits?: PhaseUnits;
    exactHydrationEstimate?: boolean;
};

export type ActionReadContext = {
    readChildActions(
        prop: ChildActionListName,
        mode?: ActionListReadMode
    ): Promise<Array<Observed<Action> | null>>;
    readConditions(prop: ChildConditionListName): Promise<Array<Condition | null>>;
    emitSnapshot(): void;
};

type ReadChildActions = (
    ctx: TaskContext,
    mode: ActionListReadMode,
    read?: ListReadOptions
) => Promise<ObservedActionSlot[]>;

type ReadConditions = (
    ctx: TaskContext,
    options?: ReadConditionListOptions
) => Promise<ObservedConditionSlot[]>;

export type CreateActionReadContextArgs = {
    ctx: TaskContext;
    actionPath: ActionPath;
    actionType: Action["type"];
    itemRegistry?: ItemRegistry;
    itemCaptures?: ItemCaptureRegistry;
    events?: SyncEventHandler;
    emitSnapshot?: () => void;
    readChildActions: ReadChildActions;
    readConditions: ReadConditions;
    /**
     * Supplies a fresh progress sink per child-list read so the child's
     * plan-derived units (pages, its own hydration entries) flow back into
     * the parent's live totals instead of staying a lump-sum estimate.
     */
    childListProgress?: (prop: ChildListName) => {
        progress: ProgressHandler;
        phaseUnits: PhaseUnits;
    };
};

export function createActionReadContext({
    ctx,
    actionPath,
    actionType,
    itemRegistry,
    itemCaptures,
    events,
    emitSnapshot,
    readChildActions,
    readConditions: readConditionList,
    childListProgress,
}: CreateActionReadContextArgs): ActionReadContext {
    const focusChildField = (path: NestedListPath): void => {
        events?.emit({
            kind: "childListReadStarted",
            path,
            actionType,
        });
    };

    return {
        async readChildActions(prop, mode = { kind: "full" }) {
            const path = ActionListPath.childOf(actionPath, prop);
            focusChildField(path);
            const actions: Array<Observed<Action> | null> = [];
            const entries = await readChildActions(ctx, mode, {
                itemRegistry,
                itemCaptures,
                events,
                listPath: path,
                emitSnapshot,
                ...(childListProgress?.(prop as ChildListName) ?? {}),
            });
            for (const entry of entries) {
                actions.push(entry.action);
            }
            return actions;
        },

        async readConditions(prop) {
            focusChildField(ConditionListPath.of(actionPath, prop));
            const conditions: Array<Condition | null> = [];
            const entries = await readConditionList(ctx, {
                itemRegistry,
                itemCaptures,
                ...(childListProgress?.(prop as ChildListName) ?? {}),
            });
            for (const entry of entries) {
                conditions.push(entry.condition);
            }
            return conditions;
        },

        emitSnapshot() {
            emitSnapshot?.();
        },
    };
}
