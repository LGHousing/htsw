import type { Action, Importable } from "htsw/types";
import type {
    KnowledgeLockStatus,
    KnowledgeSourceKind,
    KnowledgeSourceReason,
    TaskProgressEntry,
    ProgressPayload,
} from "./progress/types";
import type {
    ActionListPath,
    ActionPath,
    ActionTreePath,
    NestedListPath,
} from "./actionPath";
import type { ObservedNode } from "./observedActions";

export type DiffOpKind = "edit" | "add" | "move" | "delete";
export type DiffFinalState = "match" | "edit" | "add" | "delete";

export type DiffSummary = {
    matches: number;
    edits: number;
    moves: number;
    adds: number;
    deletes: number;
};

type ActionDiffOperationPayload =
    | {
          op: "add";
          path: ActionPath;
          actionType: Action["type"];
          toIndex: number;
      }
    | {
          op: "edit";
          path: ActionPath;
          actionType: Action["type"];
          fromIndex: number;
          toIndex: number;
          fieldsChanged: string[];
      }
    | {
          op: "move";
          path: ActionPath;
          actionType: Action["type"];
          fromIndex: number;
          toIndex: number;
      }
    | {
          op: "delete";
          path: ActionPath;
          actionType: Action["type"] | null;
      };

export type PlannedOp =
    | {
          op: "add";
          path: ActionPath;
          actionType: Action["type"];
          desired: Action;
          toIndex: number;
      }
    | {
          op: "edit";
          path: ActionPath;
          actionType: Action["type"];
          observed: Action;
          desired: Action;
          fromIndex: number;
          toIndex: number;
          fieldsChanged: string[];
      }
    | {
          op: "move";
          path: ActionPath;
          actionType: Action["type"];
          fromIndex: number;
          toIndex: number;
      }
    | {
          op: "delete";
          path: ActionPath;
          actionType: Action["type"] | null;
          observed: Action | null;
          observedEntryId: number;
          fromIndex: number;
      };

type NestedProgressScope = {
    baselineApplyUnits: number;
    parentSync: {
        completedUnits: number;
        totalUnits: number;
    };
};

export type ProgressScope =
    | { kind: "topLevel" }
    | (NestedProgressScope & { kind: "childList"; path: NestedListPath })
    | (NestedProgressScope & { kind: "menuSlotActions" });

export type SyncEvent =
    | {
          kind: "sessionStarted";
          rows: readonly TaskProgressEntry[];
          initialTotalUnits: number;
      }
    | {
          kind: "importableStarted";
          key: string;
          type: Importable["type"];
          identity: string;
          setupUnits: number;
          initialUnits: number;
          rowIndex: number;
          cached: Importable | null;
      }
    | {
          kind: "importableFinished";
          key: string;
          status: "imported" | "skipped" | "failed";
          /** Failure reason (Diagnostic message), set only when status is "failed". */
          error?: string;
      }
    | {
          /**
           * Re-activates an already-started importable as the current
           * focus without resetting its progress. Used when a later pass
           * returns to a row after the first pass advanced past it.
           */
          kind: "importableReactivated";
          key: string;
          rowIndex: number;
          phase?: ProgressPayload["phase"];
      }
    | { kind: "sessionTotalsLocked" }
    | { kind: "sessionFinished" }
    | { kind: "progress"; scope: ProgressScope; progress: ProgressPayload }
    | {
          kind: "knowledgeSourceUsed";
          source: KnowledgeSourceKind;
          reason: KnowledgeSourceReason;
          lockStatus?: KnowledgeLockStatus;
      }
    | {
          /**
           * A MENU import's apply pass moved to a grid slot. Carries the slot's
           * identity so the panel can show "slot 13 (Diamond Sword)" instead of
           * a bare op counter. `index`/`count` are the 1-based position and
           * total across the menu's whole apply (clears + item writes + action
           * syncs), so they climb monotonically across the two passes.
           */
          kind: "menuSlotStarted";
          slot: number;
          label: string | null;
          index: number;
          count: number;
      }
    | { kind: "setupStep"; label: string; completed: number; total: number }
    | { kind: "readStarted"; listPath: ActionListPath }
    | {
          kind: "childListReadStarted";
          path: ActionTreePath;
          actionType: Action["type"] | null;
      }
    | { kind: "observedSnapshot"; nodes: readonly ObservedNode[] }
    | { kind: "actionReadCompleted"; path: ActionPath; hydrated: boolean }
    | {
          kind: "diffPlanned";
          summary: DiffSummary;
          operations: PlannedOp[];
          matches: ActionPath[];
      }
    | ({ kind: "operationStarted" } & ActionDiffOperationPayload)
    | {
          kind: "operationCompleted";
          path: ActionPath;
          op: DiffOpKind;
          finalState: DiffFinalState;
          observedEntryId?: number;
      }
    | { kind: "listSyncCompleted" }
    | { kind: "blockActionHeaderApplied"; path: ActionPath }
    | { kind: "finalizeSource"; actions: ReadonlyArray<Action> };

export interface SyncEventHandler {
    emit(event: SyncEvent): void;
}

export function createSetupStepEmitter(
    events: SyncEventHandler | undefined,
    total: number
): (label: string) => void {
    let step = 0;
    return (label: string): void => {
        events?.emit({
            kind: "setupStep",
            label,
            completed: ++step,
            total,
        });
    };
}
