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
};

export type ActionLoreSpec<T extends Action> = {
    displayName: string;
    loreFields: Record<string, ActionLoreFieldSpec<T>>;
};

export type NestedListProp = "conditions" | "ifActions" | "elseActions" | "actions";

/** Nested list properties that still need to be read by clicking in. */
export type NestedPropsToRead = Set<NestedListProp>;

type NestedReadState = "none" | "summary" | "full" | "trusted";

export type NestedSummaries = Partial<Record<NestedListProp, string[]>>;

export type ActionListTrust = {
    basePath: string;
    cachedActions: readonly Action[];
    desiredActions: readonly Action[];
    trustedListPaths: ReadonlySet<string>;
};

export type NestedHydrationPlan = Map<ObservedActionSlot, NestedPropsToRead>;

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
    nestedReadState?: NestedReadState;
    nestedSummaries?: NestedSummaries;
    nestedPropsToRead?: NestedPropsToRead;
};

export type ObservedConditionSlot = {
    index: number;
    slotId: number;
    slot: ItemSlot;
    condition: Condition | null;
};

export type NestedListDiff =
    | { prop: "conditions"; diff: ConditionListDiff }
    | { prop: "ifActions" | "elseActions" | "actions"; diff: ActionListDiff };

export type ActionListOperation =
    | { kind: "move"; observed: ObservedActionSlot; toIndex: number; action: Action }
    | {
          kind: "edit";
          observed: ObservedActionSlot;
          desired: Action;
          noteOnly: boolean;
          noteDiffers: boolean;
          nestedDiffs: NestedListDiff[];
      }
    | { kind: "add"; desired: Action; toIndex: number }
    | { kind: "delete"; observed: ObservedActionSlot };

export type ActionListDiff = {
    operations: ActionListOperation[];
    desiredLength: number;
};

/**
 * Same shape as `ActionListOperation` minus `move` — the condition GUI has
 * no reorder affordance, so condition diff cannot emit moves. `edit` carries
 * `noteOnly` so the applier can short-circuit straight to `setListItemNote`
 * without opening the condition editor; the diff computes it once instead
 * of every consumer re-deriving it.
 */
export type ConditionListOperation =
    | {
          kind: "edit";
          observed: ObservedConditionSlot;
          desired: Condition;
          noteOnly: boolean;
      }
    | { kind: "add"; desired: Condition }
    | { kind: "delete"; observed: ObservedConditionSlot };

export type ConditionListDiff = {
    operations: ConditionListOperation[];
};
