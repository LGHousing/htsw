import type { Action } from "htsw/types";

import type { ItemSlot } from "../../tasks/specifics/slots";

export type NestedListProp = "conditions" | "ifActions" | "elseActions" | "actions";

/** Nested list properties that still need to be read by clicking in. */
export type NestedPropsToRead = Set<NestedListProp>;

export type ObservedAction = {
    index: number;
    slotId: number;
    slot: ItemSlot;
    type: Action["type"];
    action: Action;
    propsToRead?: NestedPropsToRead;
};

export type ActionListOperation =
    | { kind: "move"; observed: ObservedAction; toIndex: number; action: Action }
    | { kind: "edit"; observed: ObservedAction; desired: Action }
    | { kind: "add"; desired: Action; toIndex: number }
    | { kind: "delete"; observed: ObservedAction };

export type ActionListDiff = {
    operations: ActionListOperation[];
};
