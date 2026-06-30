import type { Action, Condition } from "htsw/types";

import TaskContext from "../../tasks/context";
import { type ItemRegistry } from "../../importables/itemRegistry";
import type { ActionListReadMode } from "../actions/readList";
import type {
    ListReadOptions,
    Observed,
    ObservedActionSlot,
    ObservedConditionSlot,
} from "../types";
import type { ReadConditionListOptions } from "../actions/conditions/readList";
import {
    innerListPath,
    type ActionPath,
    type ImportEventHandler,
} from "../importEvents";
import type { ItemCaptureRegistry } from "../itemCapture";

export type ActionReadContext = {
    readInnerActions(
        prop: string,
        mode?: ActionListReadMode
    ): Promise<Array<Observed<Action> | null>>;
    readConditions(prop: string): Promise<Array<Condition | null>>;
    emitSnapshot(): void;
};

type ReadInnerActions = (
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
    events?: ImportEventHandler;
    emitSnapshot?: () => void;
    readInnerActions: ReadInnerActions;
    readConditions: ReadConditions;
};

export function createActionReadContext({
    ctx,
    actionPath,
    actionType,
    itemRegistry,
    itemCaptures,
    events,
    emitSnapshot,
    readInnerActions,
    readConditions: readConditionList,
}: CreateActionReadContextArgs): ActionReadContext {
    const pathForInnerList = (prop: string): ActionPath => innerListPath(actionPath, prop);
    const focusChildField = (prop: string): ActionPath => {
        const path = pathForInnerList(prop);
        events?.emit({
            kind: "innerListReadStarted",
            path,
            actionType,
        });
        return path;
    };

    return {
        async readInnerActions(prop, mode = { kind: "deep" }) {
            const path = focusChildField(prop);
            const actions: Array<Observed<Action> | null> = [];
            const entries = await readInnerActions(ctx, mode, {
                itemRegistry,
                itemCaptures,
                events,
                listPath: path,
                emitSnapshot,
            });
            for (const entry of entries) {
                actions.push(entry.action);
            }
            return actions;
        },

        async readConditions(prop) {
            focusChildField(prop);
            const conditions: Array<Condition | null> = [];
            const entries = await readConditionList(ctx, { itemRegistry, itemCaptures });
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
