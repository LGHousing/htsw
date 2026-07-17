import type { Action, Condition } from "htsw/types";

export type UiFieldKind =
    "boolean" | "value" | "cycle" | "select" | "location" | "item" | ChildListFieldKind;

export type ChildListFieldKind = "actionList" | "conditionList";

export function isChildListFieldKind(kind: UiFieldKind): kind is ChildListFieldKind {
    return kind === "actionList" || kind === "conditionList";
}

type ConditionDataKey<T extends Condition> = Exclude<
    keyof T,
    "type" | "inverted" | "note"
>;

type ConditionLoreFieldSpec<T extends Condition> = {
    prop: ConditionDataKey<T>;
    kind: UiFieldKind;
    /**
     * Value that the Housing UI presents when the field is unset on the
     * desired side. Used by normalizeConditionCompare to treat an explicit
     * default-valued read as equivalent to an omitted field, which prevents
     * spurious diffs between parsed source and observed GUI state.
     */
    default?: unknown;
    numeric?: boolean;
    /** Required for `kind: "cycle"`: the ordered cycle options. */
    options?: readonly string[];
};

export type ConditionLoreSpec<T extends Condition> = {
    displayName: string;
    loreFields: Record<string, ConditionLoreFieldSpec<T>>;
};

type ActionDataKey<T extends Action> = Exclude<keyof T, "type" | "note">;

type ActionLoreFieldSpec<T extends Action> = {
    prop: ActionDataKey<T>;
    kind: UiFieldKind;
    /**
     * Value that the Housing UI presents when the field is unset on the
     * desired side. Used by normalizeActionCompare to treat an explicit
     * default-valued read as equivalent to an omitted field, which prevents
     * spurious diffs between parsed source and observed GUI state.
     */
    default?: unknown;
    numeric?: boolean;
    /** Required for `kind: "cycle"`: the ordered cycle options. */
    options?: readonly string[];
};

export type ActionLoreSpec<T extends Action> = {
    displayName: string;
    loreFields: Record<string, ActionLoreFieldSpec<T>>;
};
