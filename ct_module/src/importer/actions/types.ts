import type { Action, Condition } from "htsw/types";

import type { ItemSlot } from "../../tasks/specifics/slots";

export type NestedListProp = "conditions" | "ifActions" | "elseActions" | "actions";

/** Nested list properties that still need to be read by clicking in. */
export type NestedPropsToRead = Set<NestedListProp>;

export type Observed<T> = {
    [K in keyof T]: T[K] extends Action[]
        ? Array<Observed<Action> | null>
        : T[K] extends Condition[]
          ? Array<Condition | null>
          : T[K];
};

export type ObservedActionSlot = {
    index: number;
    slotId: number;
    slot: ItemSlot;
    action: Observed<Action> | null;
};

export type ObservedConditionSlot = {
    index: number;
    slotId: number;
    slot: ItemSlot;
    condition: Condition | null;
};

export type ActionListOperation =
    | { kind: "move"; observed: ObservedActionSlot; toIndex: number; action: Action }
    | { kind: "edit"; observed: ObservedActionSlot; desired: Action }
    | { kind: "add"; desired: Action; toIndex: number }
    | { kind: "delete"; observed: ObservedActionSlot };

export type ActionListDiff = {
    operations: ActionListOperation[];
};
