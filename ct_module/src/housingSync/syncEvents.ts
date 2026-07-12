import type { Action, Importable } from "htsw/types";
import type { TaskProgressEntry, ProgressPayload } from "./progress/types";

export type DiffOpKind = "edit" | "add" | "move" | "delete";
export type DiffFinalState = "match" | "edit" | "add" | "delete";

type ActionPathPart = string | number;

export type ActionPath = {
    readonly parts: readonly ActionPathPart[];
};

export function actionPathForIndex(
    listPath: ActionPath | undefined,
    index: number
): ActionPath {
    return {
        parts: listPath === undefined ? [index] : listPath.parts.concat(index),
    };
}

export function childListPath(parent: ActionPath, prop: string): ActionPath {
    return { parts: parent.parts.concat(prop) };
}

export function actionPathKey(path: ActionPath): string {
    return path.parts.map(String).join(".");
}

export function actionPathFromKey(key: string): ActionPath {
    const raw = key.split(".");
    const parts: ActionPathPart[] = [];
    for (let i = 0; i < raw.length; i++) {
        const value = Number(raw[i]);
        parts.push(String(value) === raw[i] ? value : raw[i]);
    }
    return { parts };
}

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

export type ProgressScope =
    | { kind: "topLevel" }
    | {
          kind: "childList";
          path: ActionPath;
          baselineApplyUnits: number;
          parentSync: {
              completedUnits: number;
              totalUnits: number;
          };
      };

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
    | { kind: "sessionFinished" }
    | { kind: "progress"; scope: ProgressScope; progress: ProgressPayload }
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
    | { kind: "readStarted"; listPath: string }
    | {
          kind: "childListReadStarted";
          path: ActionPath;
          actionType: Action["type"] | null;
      }
    | { kind: "observedSnapshot"; actions: ReadonlyArray<Action | null> }
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
