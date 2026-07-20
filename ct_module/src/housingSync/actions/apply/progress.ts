import type { Action } from "htsw/types";

import type { ActionListDiff, ActionListOperation } from "../diff/types";
import {
    type DiffSummary,
    type SyncEventHandler,
    type PlannedOp,
    type ProgressScope,
} from "../../syncEvents";
import { type ActionListPath, ActionPath } from "../../actionPath";
import {
    actionOperationApplyUnits,
    editUnitsWithChildLists,
    phaseUnitsTotal,
    type PhaseUnits,
} from "../../progress/costs";
import { getActionScalarLoreFields } from "../../fields/actionMappings";
import { scalarFieldDiffers } from "../../fields/compare";

export function emitDiffPlanned(
    events: SyncEventHandler | undefined,
    diff: ActionListDiff,
    desired: Action[],
    listPath: ActionListPath | undefined
): void {
    if (events === undefined) return;
    const operations: PlannedOp[] = [];
    for (const op of diff.operations) {
        const idx = desiredIndexForOp(op);
        if (idx >= 0) {
            const srcPath = ActionPath.at(listPath, idx);
            const actionType = actionTypeForOp(op);
            if (actionType === null) continue;
            if (op.kind === "add") {
                operations.push({
                    op: "add",
                    path: srcPath,
                    actionType,
                    desired: op.desired,
                    toIndex: op.toIndex,
                });
            } else if (op.kind === "edit") {
                operations.push({
                    op: "edit",
                    path: srcPath,
                    actionType,
                    observed: op.baselineAction as Action,
                    desired: op.desired,
                    fromIndex: op.fromIndex,
                    toIndex: op.desiredIndex,
                    fieldsChanged: fieldsChangedForEdit(op),
                });
            } else if (op.kind === "move") {
                operations.push({
                    op: "move",
                    path: srcPath,
                    actionType,
                    fromIndex: op.fromIndex,
                    toIndex: op.toIndex,
                });
            }
        } else if (op.kind === "delete") {
            const obsPath = ActionPath.at(listPath, op.fromIndex);
            operations.push({
                op: "delete",
                path: obsPath,
                actionType: op.baselineAction?.type ?? null,
                observed: op.baselineAction as Action | null,
                observedEntryId: op.entryId,
                fromIndex: op.fromIndex,
            });
        }
    }
    const touched = new Set<number>();
    for (const op of diff.operations) {
        const idx = desiredIndexForOp(op);
        if (idx >= 0) touched.add(idx);
    }
    const matches: ActionPath[] = [];
    for (let i = 0; i < desired.length; i++) {
        if (!touched.has(i)) matches.push(ActionPath.at(listPath, i));
    }
    events.emit({
        kind: "diffPlanned",
        summary: summarizeDiff(diff, desired.length),
        operations,
        matches,
    });
}

export function emitApplyProgress(
    events: SyncEventHandler | undefined,
    scope: ProgressScope,
    phaseUnits: PhaseUnits,
    completedUnits: number,
    completedOps: number,
    totalOps: number
): void {
    events?.emit({
        kind: "progress",
        scope,
        progress: {
            phase: "applying",
            completedUnits,
            totalUnits: phaseUnitsTotal(phaseUnits),
            phaseUnits,
            sync: {
                completedUnits: completedOps,
                totalUnits: totalOps,
                parent: null,
            },
        },
    });
}

export function desiredIndexForOp(op: ActionListOperation): number {
    if (op.kind === "add" || op.kind === "edit") return op.desiredIndex;
    if (op.kind === "move") return op.toIndex;
    return -1;
}

export function actionTypeForOp(op: ActionListOperation): Action["type"] | null {
    if (op.kind === "add" || op.kind === "edit") return op.desired.type;
    if (op.kind === "move") return op.action.type;
    return op.baselineAction?.type ?? null;
}

export function fieldsChangedForEdit(
    op: Extract<ActionListOperation, { kind: "edit" }>
): string[] {
    const fields: string[] = [];
    if (op.noteDiffers) fields.push("note");
    if (!op.noteOnly) {
        const scalarFields = getActionScalarLoreFields(op.baselineAction.type);
        for (let i = 0; i < scalarFields.length; i++) {
            const field = scalarFields[i];
            if (
                scalarFieldDiffers(
                    op.baselineAction,
                    op.desired,
                    op.baselineAction.type,
                    field.prop
                )
            ) {
                fields.push(field.prop);
            }
        }
        for (let i = 0; i < op.childListDiffs.length; i++) {
            const childList = op.childListDiffs[i];
            if (childList.diff.operations.length > 0) fields.push(childList.prop);
        }
    }
    return fields;
}

export function operationApplyUnits(
    op: ActionListOperation,
    desiredLength: number
): number {
    return actionOperationApplyUnits(op, editUnitsWithChildLists, desiredLength);
}

function summarizeDiff(diff: ActionListDiff, desiredLength: number): DiffSummary {
    let edits = 0;
    let moves = 0;
    let adds = 0;
    let deletes = 0;
    const touched = new Set<number>();
    for (const op of diff.operations) {
        const idx = desiredIndexForOp(op);
        if (idx >= 0) touched.add(idx);
        if (op.kind === "edit") edits++;
        else if (op.kind === "move") moves++;
        else if (op.kind === "add") adds++;
        else deletes++;
    }
    return {
        matches: Math.max(0, desiredLength - touched.size),
        edits,
        moves,
        adds,
        deletes,
    };
}
