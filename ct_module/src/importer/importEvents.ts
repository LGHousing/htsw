import type { Action, Importable } from "htsw/types";
import type { ImportableEntry, ProgressPayload } from "./progress/types";

export type DiffOpKind = "edit" | "add" | "move" | "delete";
export type DiffFinalState = "match" | "edit" | "add" | "delete";
export type ActionPath = string;

export type DiffSummary = {
    matches: number;
    edits: number;
    moves: number;
    adds: number;
    deletes: number;
};

export type ActionDiffOperationPayload =
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

export type ProgressScope =
    | { kind: "topLevel" }
    | {
          kind: "nestedActionList";
          path: ActionPath;
          parentActionPath: ActionPath;
          baselineApplyUnits: number;
          parentSync: {
              completedUnits: number;
              totalUnits: number;
          };
      };

export type ImportEvent =
    | {
          kind: "sessionStarted";
          rows: readonly ImportableEntry[];
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
      }
    | {
          /**
           * Re-activates an already-started importable as the current
           * focus without resetting its progress. Used by the two-pass
           * orchestrator to mark a row "current again" for its apply
           * pass after pass-1 advanced past it.
           */
          kind: "importableReactivated";
          key: string;
          rowIndex: number;
      }
    | { kind: "sessionFinished" }
    | { kind: "progress"; scope: ProgressScope; progress: ProgressPayload }
    | { kind: "setupStep"; label: string; completed: number; total: number }
    | { kind: "readStarted"; listPath: string }
    | { kind: "nestedReadStarted"; path: ActionPath; actionType: Action["type"] | null }
    | { kind: "observedSnapshot"; actions: ReadonlyArray<Action | null> }
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

export interface ImportEventHandler {
    emit(event: ImportEvent): void;
}
