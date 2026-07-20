import { Diagnostic } from "htsw";
import type { Action } from "htsw/types";

import TaskContext from "../../../tasks/context";
import type { ActionApplyContext } from "../../context/actionApplyContext";
import { createActionApplyContext } from "../../context/actionApplyContext";
import { timedWaitForMenu } from "../../menus/menuWait";
import { clickGoBack, setListItemNote } from "../../menus/menuUtils";
import {
    getPaginatedListSlotAtIndex,
    goToPaginatedListPage,
} from "../../menus/paginatedList";
import type { DiffFinalState, SyncEventHandler, ProgressScope } from "../../syncEvents";
import { ActionPath } from "../../actionPath";
import { actionListDiffApplyUnits, editUnitsWithChildLists } from "../../progress/costs";
import type { PhaseUnits } from "../../progress/types";
import type { Observed } from "../../observedActions";
import type { ActionListOperation } from "../diff/types";
import { applyConditionList } from "../conditions/apply";
import { ACTION_LIST_CONFIG } from "../listConfigs";
import type { ActionListApplyOptions, ActionListPlan } from "../plan";
import { getActionIo, writeOpenAction } from "../io";
import {
    addAction,
    actionWithNote,
    deleteObservedAction,
    moveActionToIndex,
} from "./actionOps";
import {
    actionTypeForOp,
    desiredIndexForOp,
    emitApplyProgress,
    emitDiffPlanned,
    fieldsChangedForEdit,
    operationApplyUnits,
} from "./progress";
import type { ActionListApplyResult, ApplyChildActionList } from "./types";

type LiveActionListEntry = {
    entryId: number;
    action: Observed | null;
};

type ErrorWithActionListApplyResult = {
    __htswActionListApplyResult?: ActionListApplyResult;
};

type OperationBuckets = {
    deletes: Array<ActionListOperation & { kind: "delete" }>;
    edits: Array<ActionListOperation & { kind: "edit" }>;
    moves: Array<ActionListOperation & { kind: "move" }>;
    adds: Array<ActionListOperation & { kind: "add" }>;
};

export function actionListApplyResultFromError(
    error: unknown
): ActionListApplyResult | null {
    if (error === null) return null;
    const kind = typeof error;
    if (kind !== "object" && kind !== "function") return null;
    return (error as ErrorWithActionListApplyResult).__htswActionListApplyResult ?? null;
}

function throwWithActionListApplyResult(
    error: unknown,
    result: ActionListApplyResult
): never {
    if (error instanceof Error) {
        (error as ErrorWithActionListApplyResult).__htswActionListApplyResult = result;
        throw error;
    }
    if (error instanceof Diagnostic) {
        (error as ErrorWithActionListApplyResult).__htswActionListApplyResult = result;
        throw error;
    }
    const wrapped = new Error(String(error)) as Error & ErrorWithActionListApplyResult;
    wrapped.__htswActionListApplyResult = result;
    throw wrapped;
}

function throwWithoutActionListApplyResult(error: unknown): never {
    if (error instanceof Error) {
        delete (error as ErrorWithActionListApplyResult).__htswActionListApplyResult;
        throw error;
    }
    if (error instanceof Diagnostic) {
        delete (error as ErrorWithActionListApplyResult).__htswActionListApplyResult;
        throw error;
    }
    throw new Error(String(error));
}

export class ActionListApplyRun {
    private readonly current: LiveActionListEntry[] = [];
    private readonly phaseUnits: PhaseUnits;
    private readonly events: SyncEventHandler | undefined;
    private readonly isTopLevel: boolean;
    private readonly baselineUnits: number;
    private readonly totalOps: number;
    private nextEntryId: number;
    private appliedUnits = 0;
    private completedOps = 0;
    private operationStartUnits = 0;
    private snapshotSafeForCache = true;

    constructor(
        private readonly ctx: TaskContext,
        private readonly plan: ActionListPlan,
        private readonly options: ActionListApplyOptions,
        private readonly progressScope: ProgressScope
    ) {
        for (let i = 0; i < plan.observed.length; i++) {
            this.current.push({
                entryId: i,
                action: plan.observed[i].action,
            });
        }
        this.phaseUnits = {
            setup: plan.phaseUnits.setup,
            reading: plan.phaseUnits.reading,
            hydrating: plan.phaseUnits.hydrating,
            applying: Math.max(
                actionListDiffApplyUnits(
                    plan.diff,
                    editUnitsWithChildLists,
                    plan.desired.length
                ),
                1
            ),
        };
        this.events = options.session.events;
        this.isTopLevel = options.listPath === undefined;
        this.baselineUnits = this.phaseUnits.reading + this.phaseUnits.hydrating;
        this.totalOps = plan.diff.operations.length;
        this.nextEntryId = plan.observed.length;
    }

    async apply(
        applyChildActionList: ApplyChildActionList
    ): Promise<ActionListApplyResult> {
        try {
            emitDiffPlanned(
                this.events,
                this.plan.diff,
                this.plan.desired,
                this.options.listPath
            );
            this.emitInitialProgress();

            if (this.plan.diff.operations.length === 0) {
                this.finish();
                return this.result();
            }

            const phases = this.bucketOperations();
            await this.applyDeletes(phases.deletes);
            await this.applyEdits(phases.edits, applyChildActionList);
            await this.applyMoves(phases.moves);
            await this.applyAdds(phases.adds, applyChildActionList);

            await goToPaginatedListPage(this.ctx, 1, ACTION_LIST_CONFIG);
            this.finish();
            return this.result();
        } catch (error) {
            this.throwApplyError(error);
        }
    }

    result(): ActionListApplyResult {
        return {
            currentSnapshot: this.current.map((entry) =>
                entry.action === null
                    ? null
                    : (JSON.parse(JSON.stringify(entry.action)) as Action)
            ),
        };
    }

    private bucketOperations(): OperationBuckets {
        const deletes: Array<ActionListOperation & { kind: "delete" }> = [];
        const edits: Array<ActionListOperation & { kind: "edit" }> = [];
        const moves: Array<ActionListOperation & { kind: "move" }> = [];
        const adds: Array<ActionListOperation & { kind: "add" }> = [];

        for (const op of this.plan.diff.operations) {
            switch (op.kind) {
                case "delete":
                    deletes.push(op);
                    break;
                case "edit":
                    edits.push(op);
                    break;
                case "move":
                    moves.push(op);
                    break;
                case "add":
                    adds.push(op);
                    break;
            }
        }

        return { deletes, edits, moves, adds };
    }

    private async applyDeletes(
        deletes: Array<ActionListOperation & { kind: "delete" }>
    ): Promise<void> {
        if (deletes.length === 0) return;
        deletes.sort((a, b) => b.fromIndex - a.fromIndex);

        for (let i = 0; i < deletes.length; i++) {
            const op = deletes[i];
            const index = this.findCurrentIndex(op.entryId);
            if (index === -1) continue;

            await this.beginOperation(op);
            this.markSnapshotUnsafe();
            await deleteObservedAction(this.ctx, index, this.current.length);
            this.completeDelete(op, index);
        }
    }

    private async applyEdits(
        edits: Array<ActionListOperation & { kind: "edit" }>,
        applyChildActionList: ApplyChildActionList
    ): Promise<void> {
        for (const op of edits) {
            const currentIndex = this.findCurrentIndex(op.entryId);
            if (currentIndex === -1) continue;

            await this.beginOperation(op);

            const actionSlot = await getPaginatedListSlotAtIndex(
                this.ctx,
                currentIndex,
                this.current.length,
                ACTION_LIST_CONFIG
            );

            if (op.noteOnly) {
                const snapshot = { updated: false };
                const updateSnapshot = (): void => {
                    this.updateCurrentAction(currentIndex, op.desired);
                    snapshot.updated = true;
                };
                this.markSnapshotUnsafe();
                await setListItemNote(this.ctx, actionSlot, op.desired.note, {
                    onApplied: () => {
                        updateSnapshot();
                        this.markSnapshotSafe();
                    },
                });
                if (!snapshot.updated) {
                    updateSnapshot();
                    this.markSnapshotSafe();
                }
                this.completeEdit(op);
                continue;
            }

            const spec = getActionIo(op.desired.type);
            const actionWithCurrentNote = (): Action =>
                actionWithNote(op.desired, op.baselineAction.note);
            const desiredSnapshot = { updated: false };
            const updateEditSnapshot = (action: Action, isDesired: boolean): void => {
                this.updateCurrentAction(currentIndex, action);
                if (isDesired) desiredSnapshot.updated = true;
            };
            if (spec.write) {
                actionSlot.click();
                await timedWaitForMenu(this.ctx, "menuClickWait");

                const apply = this.writerHooksFor(op, applyChildActionList);

                this.markSnapshotUnsafe();
                await writeOpenAction(this.ctx, op.desired, {
                    current: op.baselineAction,
                    itemRegistry: this.options.session.items,
                    apply,
                });
                updateEditSnapshot(actionWithCurrentNote(), false);
                this.markSnapshotSafe();
                await clickGoBack(this.ctx);
            }

            this.markSnapshotUnsafe();
            await setListItemNote(this.ctx, actionSlot, op.desired.note, {
                onApplied: () => {
                    updateEditSnapshot(op.desired, true);
                    this.markSnapshotSafe();
                },
            });
            if (!desiredSnapshot.updated) {
                updateEditSnapshot(op.desired, true);
                this.markSnapshotSafe();
            }
            this.completeEdit(op);
        }
    }

    private async applyMoves(
        moves: Array<ActionListOperation & { kind: "move" }>
    ): Promise<void> {
        moves.sort((a, b) => a.toIndex - b.toIndex);
        for (const op of moves) {
            const fromIndex = this.findCurrentIndex(op.entryId);
            if (fromIndex === -1) continue;

            await this.beginOperation(op);
            this.markSnapshotUnsafe();
            await moveActionToIndex(this.ctx, fromIndex, op.toIndex, this.current.length);
            this.completeMove(op, fromIndex);
            this.markSnapshotSafe();
        }
    }

    private async applyAdds(
        adds: Array<ActionListOperation & { kind: "add" }>,
        applyChildActionList: ApplyChildActionList
    ): Promise<void> {
        adds.sort((a, b) => a.toIndex - b.toIndex);
        let currentLength = this.current.length;
        for (const op of adds) {
            await this.beginOperation(op);

            const actionToImport = actionWithNote(op.desired, undefined);

            const added = { value: false };
            const updateAddedSnapshot = (): void => {
                if (added.value) return;
                this.appendCurrentAction(actionToImport);
                added.value = true;
            };
            const apply = this.writerHooksFor(op, applyChildActionList);
            this.markSnapshotUnsafe();
            await addAction(this.ctx, actionToImport, this.options.session.items, apply, {
                onActionAdded: () => {
                    updateAddedSnapshot();
                    this.markSnapshotSafe();
                },
            });
            if (!added.value) {
                updateAddedSnapshot();
                this.markSnapshotSafe();
            }

            this.markSnapshotUnsafe();
            await moveActionToIndex(
                this.ctx,
                currentLength,
                op.toIndex,
                currentLength + 1
            );

            this.moveCurrentEntry(currentLength, op.toIndex);
            currentLength += 1;

            if (op.desired.note !== undefined) {
                const addedSlot = await getPaginatedListSlotAtIndex(
                    this.ctx,
                    op.toIndex,
                    currentLength,
                    ACTION_LIST_CONFIG
                );
                const noteSnapshot = { updated: false };
                const updateNoteSnapshot = (): void => {
                    this.updateCurrentAction(op.toIndex, op.desired);
                    noteSnapshot.updated = true;
                };
                this.markSnapshotUnsafe();
                await setListItemNote(this.ctx, addedSlot, op.desired.note, {
                    onApplied: () => {
                        updateNoteSnapshot();
                        this.markSnapshotSafe();
                    },
                });
                if (!noteSnapshot.updated) {
                    updateNoteSnapshot();
                    this.markSnapshotSafe();
                }
            }
            this.completeAdd(op);
        }
    }

    private findCurrentIndex(entryId: number): number {
        for (let i = 0; i < this.current.length; i++) {
            if (this.current[i].entryId === entryId) return i;
        }
        return -1;
    }

    private async beginOperation(op: ActionListOperation): Promise<void> {
        this.operationStartUnits = this.appliedUnits;
        this.emitStarted(op, this.pathForOp(op));
    }

    private writerHooksFor(
        op: ActionListOperation,
        applyChildActions: ApplyChildActionList
    ): ActionApplyContext | undefined {
        const path = this.pathForOp(op);
        if (path === null || (op.kind !== "add" && op.kind !== "edit")) {
            return undefined;
        }
        return createActionApplyContext({
            ctx: this.ctx,
            actionPath: path,
            session: this.options.session,
            appliedUnits: this.appliedUnits,
            completedOps: this.completedOps,
            totalOps: this.totalOps,
            ...(op.kind === "edit" ? { childListDiffs: op.childListDiffs } : {}),
            applyChildActions,
            applyConditions: applyConditionList,
        });
    }

    private appendCurrentAction(action: Observed): number {
        const index = this.current.length;
        this.current.push({
            entryId: this.nextEntryId++,
            action,
        });
        this.markSnapshotSafe();
        return index;
    }

    private updateCurrentAction(index: number, action: Observed): void {
        this.current[index].action = action;
        this.markSnapshotSafe();
    }

    private moveCurrentEntry(fromIndex: number, toIndex: number): void {
        const entry = this.current[fromIndex];
        this.current.splice(fromIndex, 1);
        this.current.splice(toIndex, 0, entry);
        this.markSnapshotSafe();
    }

    private completeAdd(op: ActionListOperation & { kind: "add" }): void {
        this.completeUnits(op, "fromStart");
        this.emitCompleted(op, "add");
    }

    private completeEdit(op: ActionListOperation & { kind: "edit" }): void {
        this.completeUnits(op, op.noteOnly ? "add" : "fromStart");
        this.emitCompleted(op, "edit");
    }

    private completeMove(
        op: ActionListOperation & { kind: "move" },
        fromIndex: number
    ): void {
        this.moveCurrentEntry(fromIndex, op.toIndex);
        this.completeUnits(op, "add");
        this.emitCompleted(op, "match");
    }

    private completeDelete(
        op: ActionListOperation & { kind: "delete" },
        index: number
    ): void {
        this.current.splice(index, 1);
        this.markSnapshotSafe();
        this.completeUnits(op, "add");
        this.emitCompleted(op, "delete");
    }

    private markSnapshotUnsafe(): void {
        this.snapshotSafeForCache = false;
    }

    private markSnapshotSafe(): void {
        this.snapshotSafeForCache = true;
    }

    private throwApplyError(error: unknown): never {
        if (!this.snapshotSafeForCache) {
            throwWithoutActionListApplyResult(error);
        }
        throwWithActionListApplyResult(error, this.result());
    }

    private completeUnits(op: ActionListOperation, mode: "add" | "fromStart"): void {
        const units = operationApplyUnits(op, this.plan.desired.length);
        if (mode === "fromStart") {
            this.appliedUnits = Math.max(
                this.appliedUnits,
                this.operationStartUnits + units
            );
        } else {
            this.appliedUnits += units;
        }
        this.completedOps++;
        this.emitProgress();
    }

    private emitInitialProgress(): void {
        emitApplyProgress(
            this.events,
            this.progressScope,
            this.phaseUnits,
            this.baselineUnits,
            0,
            this.totalOps
        );
    }

    private emitProgress(): void {
        emitApplyProgress(
            this.events,
            this.progressScope,
            this.phaseUnits,
            this.baselineUnits + Math.min(this.appliedUnits, this.phaseUnits.applying),
            this.completedOps,
            this.totalOps
        );
    }

    private emitStarted(op: ActionListOperation, path: ActionPath | null): void {
        if (this.events === undefined || path === null || op.kind === "delete") return;
        const actionType = actionTypeForOp(op);
        if (actionType === null) return;
        if (op.kind === "add") {
            this.events.emit({
                kind: "operationStarted",
                path,
                op: "add",
                actionType,
                toIndex: op.toIndex,
            });
        } else if (op.kind === "edit") {
            this.events.emit({
                kind: "operationStarted",
                path,
                op: "edit",
                actionType,
                fromIndex: op.fromIndex,
                toIndex: op.desiredIndex,
                fieldsChanged: fieldsChangedForEdit(op),
            });
        } else {
            this.events.emit({
                kind: "operationStarted",
                path,
                op: "move",
                actionType,
                fromIndex: op.fromIndex,
                toIndex: op.toIndex,
            });
        }
    }

    private emitCompleted(op: ActionListOperation, finalState: DiffFinalState): void {
        if (this.events === undefined) return;
        const path = this.pathForOp(op);
        if (path === null) return;
        this.events.emit({
            kind: "operationCompleted",
            path,
            op: op.kind,
            finalState,
            ...(op.kind === "delete" ? { observedEntryId: op.entryId } : {}),
        });
    }

    private pathForOp(op: ActionListOperation): ActionPath | null {
        const desiredIndex = desiredIndexForOp(op);
        if (desiredIndex >= 0) return ActionPath.at(this.options.listPath, desiredIndex);
        if (op.kind === "delete")
            return ActionPath.at(this.options.listPath, op.fromIndex);
        return null;
    }

    private finish(): void {
        if (this.events === undefined || !this.isTopLevel) return;
        this.events.emit({ kind: "finalizeSource", actions: this.plan.desired });
        this.events.emit({ kind: "listSyncCompleted" });
    }
}
