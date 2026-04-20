import type { Action, Condition } from "htsw/types";

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

