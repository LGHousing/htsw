import type { Action, Condition } from "htsw/types";
import type { ItemSlot } from "../tasks/specifics/slots";
import type { ItemRegistry } from "../importables/itemRegistry";
import type { ItemCaptureRegistry } from "./itemCapture";
import type { ProgressHandler, PhaseUnits } from "./progress/types";
import type { ActionPath, SyncEventHandler } from "./syncEvents";

export type UiFieldKind =
    | "boolean"
    | "value"
    | "cycle"
    | "select"
    | "location"
    | "item"
    | "childList";

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

export type ChildListName = "conditions" | "ifActions" | "elseActions" | "actions";

/** Child list properties that still need to be read by clicking in. */
export type ChildListsToRead = Set<ChildListName>;

type ChildListReadState = "none" | "shallow" | "deep";

export type ChildListSummaries = Partial<Record<ChildListName, string[]>>;

export type TrustedChildListSnapshot =
    | {
          kind: "actions";
          actions: readonly Action[];
      }
    | {
          kind: "conditions";
          conditions: readonly Condition[];
      };

export type ActionListTrust = {
    basePath: string;
    trustedChildListPaths: ReadonlySet<string>;
    trustedChildLists: ReadonlyMap<string, TrustedChildListSnapshot>;
};

export type ActionScalarFieldToRead = {
    label: string;
    prop: string;
    kind: UiFieldKind;
};

export type ActionItemFieldToCapture = {
    label: string;
    prop: string;
};

export type ActionHydrationWork = {
    childListsToRead: ChildListsToRead;
    scalarFieldsToRead: ActionScalarFieldToRead[];
    itemFieldsToCapture: ActionItemFieldToCapture[];
};

export type ActionHydrationPlan = Map<ObservedActionSlot, ActionHydrationWork>;

export type Observed<T> = {
    [K in keyof T]: T[K] extends Action[]
        ? Array<Observed<Action> | null>
        : T[K] extends Condition[]
          ? Array<Condition | null>
          : T[K];
};

export type ObservedActionSlot = {
    index: number;
    slotId?: number;
    slot?: ItemSlot;
    action: Observed<Action> | null;
    childListReadState?: ChildListReadState;
    childListSummaries?: ChildListSummaries;
    childListsToRead?: ChildListsToRead;
};

export type ObservedConditionSlot = {
    index: number;
    slotId?: number;
    slot?: ItemSlot;
    condition: Condition | null;
};

export type CurrentActionListEntry = {
    entryId: number;
    index: number;
    action: Observed<Action> | null;
};

export type CurrentConditionListEntry = {
    entryId: number;
    condition: Condition | null;
};

export type ChildListDiff =
    | { prop: "conditions"; diff: ConditionListDiff }
    | { prop: "ifActions" | "elseActions" | "actions"; diff: ActionListDiff };

export type ActionListOperation =
    | {
          kind: "move";
          entryId: number;
          fromIndex: number;
          toIndex: number;
          action: Action;
      }
    | {
          kind: "edit";
          entryId: number;
          fromIndex: number;
          desiredIndex: number;
          baselineAction: Observed<Action>;
          desired: Action;
          noteOnly: boolean;
          noteDiffers: boolean;
          childListDiffs: ChildListDiff[];
      }
    | { kind: "add"; desiredIndex: number; desired: Action; toIndex: number }
    | {
          kind: "delete";
          entryId: number;
          fromIndex: number;
          baselineAction: Observed<Action> | null;
      };

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
          entryId: number;
          baselineCondition: Condition;
          desired: Condition;
          noteOnly: boolean;
      }
    | { kind: "add"; desired: Condition }
    | {
          kind: "delete";
          entryId: number;
          baselineCondition: Condition | null;
      };

export type ConditionListDiff = {
    operations: ConditionListOperation[];
};

type ReadContext = {
    itemRegistry?: ItemRegistry;
    itemCaptures?: ItemCaptureRegistry;
    events?: SyncEventHandler;
    listPath?: ActionPath;
    emitSnapshot?: () => void;
};

export type ListReadOptions = ReadContext & {
    progress?: ProgressHandler;
    phaseUnits?: PhaseUnits;
};
