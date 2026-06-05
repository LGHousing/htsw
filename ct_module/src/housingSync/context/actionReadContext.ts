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
import type { ReadConditionListOptions } from "../conditions/readList";
import {
    nestedActionPath,
    type ActionPath,
    type ImportEventHandler,
} from "../importEvents";
import type { ItemCaptureRegistry } from "../itemCapture";

export type ActionReadContext = {
    readNestedActions(
        prop: string,
        mode?: ActionListReadMode
    ): Promise<Array<Observed<Action> | null>>;
    readNestedConditions(prop: string): Promise<Array<Condition | null>>;
    emitSnapshot(): void;
};

type ReadNestedActions = (
    ctx: TaskContext,
    mode: ActionListReadMode,
    read?: ListReadOptions
) => Promise<ObservedActionSlot[]>;

type ReadNestedConditions = (
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
    readNestedActions: ReadNestedActions;
    readNestedConditions: ReadNestedConditions;
};

export function createActionReadContext({
    ctx,
    actionPath,
    actionType,
    itemRegistry,
    itemCaptures,
    events,
    emitSnapshot,
    readNestedActions,
    readNestedConditions,
}: CreateActionReadContextArgs): ActionReadContext {
    const nestedPath = (prop: string): ActionPath => nestedActionPath(actionPath, prop);
    const focusNested = (prop: string): ActionPath => {
        const path = nestedPath(prop);
        events?.emit({
            kind: "nestedReadStarted",
            path,
            actionType,
        });
        return path;
    };

    return {
        async readNestedActions(prop, mode = { kind: "full" }) {
            const path = focusNested(prop);
            const actions: Array<Observed<Action> | null> = [];
            const entries = await readNestedActions(ctx, mode, {
                itemRegistry,
                itemCaptures,
                events,
                pathPrefix: path,
                emitSnapshot,
            });
            for (const entry of entries) {
                actions.push(entry.action);
            }
            return actions;
        },

        async readNestedConditions(prop) {
            focusNested(prop);
            const conditions: Array<Condition | null> = [];
            const entries = await readNestedConditions(ctx, { itemRegistry });
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
