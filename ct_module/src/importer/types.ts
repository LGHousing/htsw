import type { Action, Condition } from "htsw/types";
import type { ItemSlot } from "../tasks/specifics/slots";

export type UiFieldKind =
    | "boolean"
    | "value"
    | "cycle"
    | "select"
    | "item"
    | "nestedList";

type ConditionDataKey<T extends Condition> = Exclude<
    keyof T,
    "type" | "inverted" | "note"
>;

export type ConditionLoreFieldSpec<T extends Condition> = {
    prop: ConditionDataKey<T>;
    kind: UiFieldKind;
};

export type ConditionLoreSpec<T extends Condition> = {
    displayName: string;
    loreFields: Record<string, ConditionLoreFieldSpec<T>>;
};

type ActionDataKey<T extends Action> = Exclude<keyof T, "type" | "note">;

export type ActionLoreFieldSpec<T extends Action> = {
    prop: ActionDataKey<T>;
    kind: UiFieldKind;
};

export type ActionLoreSpec<T extends Action> = {
    displayName: string;
    loreFields: Record<string, ActionLoreFieldSpec<T>>;
};

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
    | {
          kind: "edit";
          observed: ObservedActionSlot;
          desired: Action;
          noteOnly: boolean;
      }
    | { kind: "add"; desired: Action; toIndex: number }
    | { kind: "delete"; observed: ObservedActionSlot };

export type ActionListDiff = {
    operations: ActionListOperation[];
};
