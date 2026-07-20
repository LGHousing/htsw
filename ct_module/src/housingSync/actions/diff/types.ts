import type { Action, Condition } from "htsw/types";

import type { ChildActionListName, ChildConditionListName } from "../../actionPath";
import type { Observed } from "../../observedActions";

export type ChildListDiff =
    | { prop: ChildConditionListName; diff: ConditionListDiff }
    | { prop: ChildActionListName; diff: ActionListDiff };

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
          baselineAction: Observed;
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
          baselineAction: Observed | null;
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
};

export type CurrentConditionListEntry = {
    entryId: number;
    condition: Condition | null;
};
