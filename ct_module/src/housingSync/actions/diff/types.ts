import type { Condition } from "htsw/types";

import type { ChildActionListName, ChildConditionListName } from "../../actionPath";
import type { Observed } from "../../observedActions";
import type { ChildAction, RootAction } from "../childActions";

export type { ChildAction, RootAction } from "../childActions";

export type ChildActionListOperation =
    | {
          kind: "move";
          entryId: number;
          fromIndex: number;
          toIndex: number;
          action: ChildAction;
      }
    | {
          kind: "edit";
          entryId: number;
          fromIndex: number;
          desiredIndex: number;
          baselineAction: Observed<ChildAction>;
          desired: ChildAction;
          noteOnly: boolean;
          noteDiffers: boolean;
          childListDiffs: ChildConditionListDiff[];
      }
    | {
          kind: "add";
          desiredIndex: number;
          desired: ChildAction;
          toIndex: number;
          childListDiffs: ChildConditionListDiff[];
      }
    | {
          kind: "delete";
          entryId: number;
          fromIndex: number;
          baselineAction: Observed<ChildAction> | null;
      };

export type ChildActionListDiff = {
    operations: ChildActionListOperation[];
    desiredLength: number;
};

export type ChildConditionListDiff = {
    kind: "conditions";
    prop: ChildConditionListName;
    diff: ConditionListDiff;
};

export type ChildListDiff =
    | ChildConditionListDiff
    | {
          kind: "actions";
          prop: ChildActionListName;
          diff: ChildActionListDiff;
      };

export type ActionListOperation =
    | {
          kind: "move";
          entryId: number;
          fromIndex: number;
          toIndex: number;
          action: RootAction;
      }
    | {
          kind: "edit";
          entryId: number;
          fromIndex: number;
          desiredIndex: number;
          baselineAction: Observed<RootAction>;
          desired: RootAction;
          noteOnly: boolean;
          noteDiffers: boolean;
          childListDiffs: ChildListDiff[];
      }
    | {
          kind: "add";
          desiredIndex: number;
          desired: RootAction;
          toIndex: number;
          childListDiffs: ChildListDiff[];
      }
    | {
          kind: "delete";
          entryId: number;
          fromIndex: number;
          baselineAction: Observed<RootAction> | null;
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

export type CurrentActionListEntry = {
    entryId: number;
    index: number;
    action: Observed | null;
    editable: boolean;
};

export type CurrentConditionListEntry = {
    entryId: number;
    condition: Condition | null;
};
