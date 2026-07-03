import type TaskContext from "../../../../tasks/context";
import {
    clickGoBack,
    setListItemNote,
} from "../../../menus/menuUtils";
import { timedWaitForMenu } from "../../../menus/menuWait";
import { getPaginatedListSlotAtIndex } from "../../../menus/paginatedList";
import { CONDITION_LIST_CONFIG } from "../../listConfigs";
import type {
    ConditionListDiff,
    ConditionListOperation,
    ObservedConditionSlot,
} from "../../../types";
import {
    conditionListDiffApplyUnits,
    conditionOperationUnits,
    phaseUnitsTotal,
} from "../../../progress/costs";
import type { PhaseUnits } from "../../../progress/types";
import { traceConditionOp } from "../../../trace/progressTrace";
import { writeOpenCondition } from "../specs";
import {
    addConditionToOpenConditionList,
    deleteObservedCondition,
    setOpenConditionInverted,
} from "./conditionOps";
import type {
    ApplyConditionListOptions,
} from "./types";

type LiveConditionListEntry = {
    entryId: number;
};

type OperationBuckets = {
    edits: Array<ConditionListOperation & { kind: "edit" }>;
    deletes: Array<ConditionListOperation & { kind: "delete" }>;
    adds: Array<ConditionListOperation & { kind: "add" }>;
};

export class ConditionListApplyRun {
    private readonly current: LiveConditionListEntry[] = [];
    private readonly plannedApplyUnits: number;
    private readonly baselineUnits: number;
    private readonly totalOps: number;
    private nextEntryId: number;
    private completedUnits = 0;
    private completedOps = 0;
    private hasEmittedProgress = false;

    constructor(
        private readonly ctx: TaskContext,
        observed: ObservedConditionSlot[],
        private readonly diff: ConditionListDiff,
        private readonly options: ApplyConditionListOptions,
        private readonly phaseUnits: PhaseUnits
    ) {
        for (let i = 0; i < observed.length; i++) {
            this.current.push({
                entryId: i,
            });
        }

        this.plannedApplyUnits = conditionListDiffApplyUnits(diff);
        this.phaseUnits.applying = this.plannedApplyUnits;
        this.baselineUnits = this.phaseUnits.reading + this.phaseUnits.hydrating;
        this.totalOps = diff.operations.length;
        this.nextEntryId = observed.length;
    }

    async apply(): Promise<void> {
        if (this.diff.operations.length === 0) {
            this.emitNoop();
            return;
        }

        const phases = this.bucketOperations();
        await this.applyEdits(phases.edits);
        await this.applyDeletes(phases.deletes);
        await this.applyAdds(phases.adds);
        this.finishProgress();
    }

    private bucketOperations(): OperationBuckets {
        const edits: Array<ConditionListOperation & { kind: "edit" }> = [];
        const deletes: Array<ConditionListOperation & { kind: "delete" }> = [];
        const adds: Array<ConditionListOperation & { kind: "add" }> = [];

        for (const op of this.diff.operations) {
            switch (op.kind) {
                case "edit":
                    edits.push(op);
                    break;
                case "delete":
                    deletes.push(op);
                    break;
                case "add":
                    adds.push(op);
                    break;
            }
        }

        return { edits, deletes, adds };
    }

    private async applyEdits(
        edits: Array<ConditionListOperation & { kind: "edit" }>
    ): Promise<void> {
        for (const op of edits) {
            const currentIndex = this.findCurrentIndex(op.entryId);
            if (currentIndex === -1) continue;

            this.emitProgress();
            traceConditionOp({
                opKind: op.noteOnly ? "noteOnly" : "edit",
                conditionType: op.desired.type,
                units: conditionOperationUnits(op),
                invertChanged:
                    (op.baselineCondition.inverted === true) !==
                    (op.desired.inverted === true),
            });

            const conditionSlot = await getPaginatedListSlotAtIndex(
                this.ctx,
                currentIndex,
                this.current.length,
                CONDITION_LIST_CONFIG
            );

            if (op.noteOnly) {
                await setListItemNote(this.ctx, conditionSlot, op.desired.note);
                this.completeOperation(op);
                continue;
            }

            conditionSlot.click();
            await timedWaitForMenu(this.ctx, "menuClickWait");

            await writeOpenCondition(
                this.ctx,
                op.desired,
                op.baselineCondition,
                this.options.itemRegistry
            );

            const currentInverted = op.baselineCondition.inverted === true;
            const desiredInverted = op.desired.inverted === true;
            await setOpenConditionInverted(this.ctx, desiredInverted, currentInverted);

            await clickGoBack(this.ctx);

            await setListItemNote(this.ctx, conditionSlot, op.desired.note);
            this.completeOperation(op);
        }
    }

    private async applyDeletes(
        deletes: Array<ConditionListOperation & { kind: "delete" }>
    ): Promise<void> {
        deletes.sort((a, b) => {
            const bIndex = this.findCurrentIndex(b.entryId);
            const aIndex = this.findCurrentIndex(a.entryId);
            return bIndex - aIndex;
        });

        for (const op of deletes) {
            const index = this.findCurrentIndex(op.entryId);
            if (index === -1) continue;

            this.emitProgress();
            traceConditionOp({
                opKind: "delete",
                conditionType: op.baselineCondition?.type ?? "unknown",
                units: conditionOperationUnits(op),
            });

            await deleteObservedCondition(this.ctx, index, this.current.length);
            this.current.splice(index, 1);
            this.completeOperation(op);
        }
    }

    private async applyAdds(
        adds: Array<ConditionListOperation & { kind: "add" }>
    ): Promise<void> {
        for (const op of adds) {
            this.emitProgress();
            traceConditionOp({
                opKind: "add",
                conditionType: op.desired.type,
                units: conditionOperationUnits(op),
            });
            await addConditionToOpenConditionList(
                this.ctx,
                op.desired,
                this.options.itemRegistry
            );
            this.appendCurrentEntry();
            this.completeOperation(op);
        }
    }

    private findCurrentIndex(entryId: number): number {
        for (let i = 0; i < this.current.length; i++) {
            if (this.current[i].entryId === entryId) return i;
        }
        return -1;
    }

    private appendCurrentEntry(): void {
        this.current.push({ entryId: this.nextEntryId++ });
    }

    private completeOperation(op: ConditionListOperation): void {
        this.completedUnits += conditionOperationUnits(op);
        this.completedOps++;
    }

    private emitProgress(): void {
        const progress = this.options.progress;
        if (progress === undefined || this.totalOps === 0) return;
        this.hasEmittedProgress = true;
        progress({
            phase: "applying",
            completedUnits: this.baselineUnits + this.completedUnits,
            totalUnits: phaseUnitsTotal(this.phaseUnits),
            phaseUnits: this.phaseUnits,
            sync: {
                completedUnits: this.completedOps,
                totalUnits: this.totalOps,
                parent: null,
            },
        });
    }

    private emitNoop(): void {
        const progress = this.options.progress;
        if (progress === undefined) return;
        progress({
            phase: "applying",
            completedUnits: this.baselineUnits + this.plannedApplyUnits,
            totalUnits: phaseUnitsTotal(this.phaseUnits),
            phaseUnits: this.phaseUnits,
            sync: { completedUnits: 1, totalUnits: 1, parent: null },
        });
    }

    private finishProgress(): void {
        if (this.hasEmittedProgress) {
            this.emitProgress();
        }
    }
}
