import type { Condition } from "htsw/types";

export type UiFieldKind =
    | "boolean"
    | "value"
    | "cycle"
    | "select"
    | "item";

type ConditionDataKey<T extends Condition> = Exclude<
    keyof T,
    "type" | "inverted" | "note"
>;

export type ConditionLoreFieldSpec<T extends Condition> = {
    prop: ConditionDataKey<T>;
    kind: UiFieldKind;
};

export type ConditionLoreSpec<T extends Condition> = {
    loreFields: Record<string, ConditionLoreFieldSpec<T>>;
};

