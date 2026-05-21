import type { Action } from "htsw/types";
import type { ActionListProgressFields } from "./progress/types";

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

export type ActionDiffOperationPayload = {
    path: ActionPath;
    op: DiffOpKind;
    actionType: Action["type"];
    fromIndex?: number;
    toIndex?: number;
    fieldsChanged?: string[];
};

export type ImportPreviewEvent =
    | { kind: "progress"; progress: ActionListProgressFields }
    | { kind: "readStarted"; listPath: string }
    | { kind: "readCompleted"; listPath: string; observedCount: number }
    | { kind: "hydrationStarted"; path: ActionPath; actionType: Action["type"] | null }
    | { kind: "hydrationCompleted"; path: ActionPath }
    | { kind: "observedSnapshot"; actions: ReadonlyArray<Action | null> }
    | { kind: "reading"; path: ActionPath; actionType: Action["type"] | null }
    | { kind: "clearReading" }
    | { kind: "diffComputed"; summary: DiffSummary }
    | ({ kind: "operationPlanned" } & ActionDiffOperationPayload)
    | {
          kind: "extraActionPlanned";
          observedEntryId: number;
          index: number;
          actionType: Action["type"] | null;
      }
    | { kind: "match"; path: ActionPath }
    | ({ kind: "operationStarted" } & ActionDiffOperationPayload)
    | {
          kind: "operationCompleted";
          path: ActionPath;
          op: DiffOpKind;
          finalState: DiffFinalState;
      }
    | { kind: "extraActionDeleted"; observedEntryId: number }
    | { kind: "syncCompleted" }
    | { kind: "blockActionHeaderApplied"; path: ActionPath }
    | { kind: "plannedAdd"; path: ActionPath; desired: Action; toIndex: number }
    | { kind: "plannedEdit"; path: ActionPath; observed: Action; desired: Action }
    | { kind: "plannedDelete"; path: ActionPath; observed: Action }
    | { kind: "plannedMove"; path: ActionPath; fromIndex: number; toIndex: number }
    | {
          kind: "applyDone";
          path: ActionPath;
          finalState: DiffFinalState;
          op: DiffOpKind;
      }
    | { kind: "finalizeSource"; actions: ReadonlyArray<Action> };

export interface ImportPreviewEventHandler {
    emit(event: ImportPreviewEvent): void;
}
