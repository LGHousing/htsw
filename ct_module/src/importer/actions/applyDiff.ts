/**
 * Mutates a Housing action list to match a desired list, given a precomputed
 * diff. Includes `importAction` (single-action add) because the `adds` loop
 * is its only caller.
 *
 * Module graph note: this file imports `writeOpenAction`,
 * `actionPathForIndex`, `getActionSpec`, and
 * `isLimitExceeded` from `../actions`. The writers in `../actions` reach
 * back into `./sync` (which itself imports from this file) for nested
 * `syncActionList` calls. This is a function-reference cycle that resolves
 * fine at runtime — don't try to "fix" it by relocating `writeOpenAction`.
 */
import { Diagnostic } from "htsw";
import type { Action } from "htsw/types";

import TaskContext from "../../tasks/context";
import { type ItemRegistry } from "../../importables/itemRegistry";
import {
    clickGoBack,
    getSlotPaginate,
    isLimitExceeded,
    setListItemNote,
    setNoteOnLastVisibleSlot,
    timedWaitForMenu,
    waitForMenu,
} from "../helpers";
import { MouseButton } from "../../tasks/specifics/slots";
import { getEditFieldDiffs } from "../compare";
import type {
    ActionListDiff,
    ActionListOperation,
    ObservedActionSlot,
} from "../types";
import type { ActionListProgressSink } from "../progress/types";
import { createApplyProgressAdapter } from "../progress/nested";
import {
    getPaginatedListSlotAtIndex,
    goToPaginatedListPage,
} from "../paginatedList";
import {
    getActiveDiffSink,
    type ImportDiffSink,
    type DiffSummary,
} from "../diffSink";
import {
    COST,
    actionListDiffApplyBudget,
    moveBudget,
    scalarFieldEditBudget,
    type ActionListPhaseBudget,
} from "../progress/costs";
import { setCurrentPhase, timed } from "../progress/timing";
import { ACTION_LIST_CONFIG } from "./listConfig";
import {
    actionPathForIndex,
    getActionSpec,
    writeOpenAction,
} from "../actions";
import { actionLogLabel, editDiffSummary } from "./log";

export async function importAction(
    ctx: TaskContext,
    action: Action,
    itemRegistry?: ItemRegistry,
    progress?: ActionListProgressSink,
    pathPrefix?: string
): Promise<void> {
    ctx.getMenuItemSlot("Add Action").click();
    await timedWaitForMenu(ctx, "menuClickWait");

    const spec = getActionSpec(action.type);
    const displayName = spec.displayName;

    const slot = await getSlotPaginate(ctx, displayName);

    if (isLimitExceeded(slot, "action")) {
        throw Diagnostic.error(`Maximum amount of ${displayName} actions exceeded`);
    }

    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");

    // No-field actions (e.g. Kill Player, Exit) add directly to the list
    // without opening an editor.
    if (spec.write) {
        await writeOpenAction(ctx, action, {
            itemRegistry,
            pathPrefix,
            onProgress: progress,
        });
        await clickGoBack(ctx);
    }

    await setNoteOnLastVisibleSlot(ctx, action.note);
}

async function deleteObservedAction(
    ctx: TaskContext,
    index: number,
    listLength: number
): Promise<void> {
    const slot = await getPaginatedListSlotAtIndex(ctx, index, listLength, ACTION_LIST_CONFIG);
    slot.click(MouseButton.RIGHT);
    await timedWaitForMenu(ctx, "menuClickWait");
}

async function moveActionToIndex(
    ctx: TaskContext,
    fromIndex: number,
    toIndex: number,
    listLength: number
): Promise<void> {
    if (listLength <= 1) {
        return;
    }

    const targetIndex = ((toIndex % listLength) + listLength) % listLength;
    let currentIndex = ((fromIndex % listLength) + listLength) % listLength;

    for (let attempt = 0; attempt < 128 && currentIndex !== targetIndex; attempt++) {
        const rightDistance = (targetIndex - currentIndex + listLength) % listLength;
        const leftDistance = (currentIndex - targetIndex + listLength) % listLength;
        const button =
            leftDistance <= rightDistance ? MouseButton.LEFT : MouseButton.RIGHT;

        const currentSlot = await getPaginatedListSlotAtIndex(ctx, currentIndex, listLength, ACTION_LIST_CONFIG);
        currentSlot.click(button, true);
        await timed("reorderStep", COST.reorderStep, () => waitForMenu(ctx));

        if (button === MouseButton.LEFT) {
            currentIndex = (currentIndex - 1 + listLength) % listLength;
        } else {
            currentIndex = (currentIndex + 1) % listLength;
        }
    }

    if (currentIndex !== targetIndex) {
        throw new Error(
            `Failed to move action from index ${fromIndex} to ${toIndex} within ${listLength} item(s).`
        );
    }
}

export async function applyActionListDiff(
    ctx: TaskContext,
    observed: ObservedActionSlot[],
    desired: Action[],
    diff: ActionListDiff,
    itemRegistry?: ItemRegistry,
    progress?: ActionListProgressSink,
    pathPrefix?: string,
    phaseBudget?: ActionListPhaseBudget
): Promise<void> {
    const sink = getActiveDiffSink();
    await applyActionListDiffInner(
        ctx,
        observed,
        desired,
        diff,
        sink,
        itemRegistry,
        progress,
        pathPrefix,
        phaseBudget
    );
}

function recomputeTotal(b: ActionListPhaseBudget): number {
    return b.readPart + b.hydratePart + b.applyPart;
}

function srcIndexForOp(op: ActionListOperation, desired: Action[]): number {
    if (op.kind === "add" || op.kind === "move") return op.toIndex;
    if (op.kind === "edit") return desired.indexOf(op.desired);
    return -1; // delete: action isn't in source
}

function opLabel(op: ActionListOperation): string {
    if (op.kind === "delete") return `delete ${actionLogLabel(op.observed.action)}`;
    if (op.kind === "edit") return `edit → ${actionLogLabel(op.desired)}`;
    if (op.kind === "move") return `move ${actionLogLabel(op.action)} → #${op.toIndex + 1}`;
    return `add ${actionLogLabel(op.desired)}`;
}

function opDetail(op: ActionListOperation): string {
    if (op.kind === "edit") return editDiffSummary(op);
    if (op.kind === "move") return `#${op.observed.index + 1} -> #${op.toIndex + 1}`;
    if (op.kind === "add") return "add source action";
    return "delete Housing-only action";
}

function editOperationFieldBudget(
    op: Extract<ActionListOperation, { kind: "edit" }>
): number {
    const { fieldDiffs } = getEditFieldDiffs(op);
    return scalarFieldEditBudget(fieldDiffs);
}

function operationApplyBudget(
    op: ActionListOperation,
    desiredLength: number
): number {
    if (op.kind === "delete") return COST.menuClickWait;
    if (op.kind === "move") {
        return moveBudget(op.observed.index, op.toIndex, desiredLength);
    }
    if (op.kind === "add") {
        const fakeDiff: ActionListDiff = { operations: [op] };
        return actionListDiffApplyBudget(fakeDiff, editOperationFieldBudget, desiredLength);
    }
    const fakeDiff: ActionListDiff = { operations: [op] };
    return actionListDiffApplyBudget(fakeDiff, editOperationFieldBudget, desiredLength);
}

function summarizeDiff(
    diff: ActionListDiff,
    desiredLength: number,
    desired: Action[]
): DiffSummary {
    let edits = 0;
    let moves = 0;
    let adds = 0;
    let deletes = 0;
    const touched = new Set<number>();
    for (const op of diff.operations) {
        const idx = srcIndexForOp(op, desired);
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

async function applyActionListDiffInner(
    ctx: TaskContext,
    observed: ObservedActionSlot[],
    desired: Action[],
    diff: ActionListDiff,
    sink: ImportDiffSink | null,
    itemRegistry?: ItemRegistry,
    progress?: ActionListProgressSink,
    pathPrefix?: string,
    phaseBudget?: ActionListPhaseBudget
): Promise<void> {
    const summary = summarizeDiff(diff, desired.length, desired);
    const plannedApplyBudget = actionListDiffApplyBudget(
        diff,
        editOperationFieldBudget,
        desired.length
    );
    // Lock the phase budget's apply portion to the actual diff work — the
    // initial estimate from desired-only was a worst-case placeholder.
    if (phaseBudget !== undefined) {
        phaseBudget.applyPart = Math.max(plannedApplyBudget, 1);
        phaseBudget.total = recomputeTotal(phaseBudget);
    }
    const baseline = phaseBudget !== undefined
        ? phaseBudget.readPart + phaseBudget.hydratePart
        : 0;
    const applyProgress =
        phaseBudget === undefined
            ? null
            : createApplyProgressAdapter({
                  phaseBudget,
                  unitTotal: Math.max(1, diff.operations.length),
                  baseline,
                  sink: progress,
              });
    if (sink !== null) {
        sink.summary(summary);
        sink.phase("computed diff");
        for (const op of diff.operations) {
            const idx = srcIndexForOp(op, desired);
            if (idx >= 0) {
                sink.planOp(actionPathForIndex(pathPrefix, idx), op.kind, opLabel(op), opDetail(op));
            } else if (op.kind === "delete") {
                sink.deleteOp(op.observed.index, opLabel(op), opDetail(op));
            }
        }
    }
    // Diffing is in-process compute (~1-5ms) with no menu round-trips —
    // we don't track timing for it. The progress event still fires so the
    // GUI's diff-sink can display the diff summary, but `setCurrentPhase`
    // jumps straight to "applying" and the budget math skips diffPart.
    const diffLabel =
        `${summary.edits} edits · ${summary.adds} adds · ${summary.deletes} deletes · ${summary.moves} moves`;
    if (phaseBudget !== undefined) {
        progress?.({
            phase: "diffing",
            phaseLabel: diffLabel,
            unitCompleted: 1,
            unitTotal: 1,
            estimatedCompleted: baseline,
            estimatedTotal: phaseBudget.total,
            etaConfidence: "planned",
            phaseBudget,
        });
    } else {
        progress?.({
            phase: "diffing",
            phaseLabel: diffLabel,
            unitCompleted: 1,
            unitTotal: 1,
            estimatedCompleted: 0,
            estimatedTotal: plannedApplyBudget,
            etaConfidence: "planned",
            phaseBudget: null,
        });
    }
    setCurrentPhase("applying");
    // The applying phase performs many awaited menu round-trips; any
    // throw between here and the function exit must still clear the
    // currentPhase, otherwise per-phase timing accumulates against
    // "applying" forever after a failure. Wrap the rest of the body in
    // try/finally so the phase is reset on every exit path including
    // exceptions and the early-return for empty diffs.
    try {
    // Pre-mark already-matching desired actions. Anything not touched by an
    // op is "match" (white) from the start; ops will paint their own state
    // on completion.
    if (sink !== null) {
        const touched = new Set<number>();
        for (const op of diff.operations) {
            const idx = srcIndexForOp(op, desired);
            if (idx >= 0) touched.add(idx);
        }
        for (let i = 0; i < desired.length; i++) {
            if (!touched.has(i)) sink.markMatch(actionPathForIndex(pathPrefix, i));
        }
    }

    if (diff.operations.length === 0) {
        if (sink !== null) sink.end();
        return;
    }

    const emitApplying = (label: string, completedOps: number, applied: number): void => {
        if (applyProgress !== null) {
            applyProgress.emitOuter(label, completedOps, applied);
        } else {
            progress?.({
                phase: "applying",
                phaseLabel: label,
                unitCompleted: completedOps,
                unitTotal: diff.operations.length,
                estimatedCompleted: applied,
                estimatedTotal: plannedApplyBudget,
                etaConfidence: "planned",
                phaseBudget: null,
            });
        }
    };

    const deletes: Array<ActionListOperation & { kind: "delete" }> = [];
    const edits: Array<ActionListOperation & { kind: "edit" }> = [];
    const moves: Array<ActionListOperation & { kind: "move" }> = [];
    const adds: Array<ActionListOperation & { kind: "add" }> = [];

    for (const op of diff.operations) {
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

    let appliedBudget = 0;

    // Deletes first (reverse order so indices stay valid), then refresh slot refs.
    if (deletes.length > 0) {
        deletes.sort((a, b) => b.observed.index - a.observed.index);
        const currentObserved = [...observed];

        for (let i = 0; i < deletes.length; i++) {
            const op = deletes[i];
            const index = currentObserved.indexOf(op.observed);
            if (index === -1) {
                continue;
            }

            emitApplying(opLabel(op), i, appliedBudget);
            if (sink !== null) sink.phase(opLabel(op));
            await deleteObservedAction(ctx, index, currentObserved.length);
            appliedBudget += operationApplyBudget(op, desired.length);
            currentObserved.splice(index, 1);
        }
    }

    const remainingObserved = observed.filter(
        (entry) => !deletes.some((op) => op.observed === entry)
    );
    for (let i = 0; i < remainingObserved.length; i++) {
        remainingObserved[i].index = i;
    }

    // Edits before moves: edits use slot refs from readActionList which
    // become stale after moves shift actions around. Moves re-read slots
    // internally so they're unaffected by prior edits.
    let appliedOps = deletes.length;
    for (const op of edits) {
        const currentIndex = remainingObserved.indexOf(op.observed);
        if (currentIndex === -1) {
            continue;
        }

        const srcIdx = srcIndexForOp(op, desired);
        const srcPath = srcIdx >= 0 ? actionPathForIndex(pathPrefix, srcIdx) : null;
        if (sink !== null && srcPath !== null) sink.beginOp(srcPath, "edit", opLabel(op));
        emitApplying(opLabel(op), appliedOps, appliedBudget);
        appliedOps++;

        const actionSlot = await getPaginatedListSlotAtIndex(
            ctx,
            currentIndex,
            remainingObserved.length,
            ACTION_LIST_CONFIG
        );
        op.observed.slot = actionSlot;
        op.observed.slotId = actionSlot.getSlotId();

        if (op.noteOnly) {
            await setListItemNote(ctx, actionSlot, op.desired.note);
            appliedBudget += operationApplyBudget(op, desired.length);
            if (sink !== null && srcPath !== null) sink.completeOp(srcPath, "edit");
            continue;
        }

        const spec = getActionSpec(op.desired.type);
        if (spec.write) {
            actionSlot.click();
            await timedWaitForMenu(ctx, "menuClickWait");

            if (!op.observed.action) {
                throw new Error(
                    "Observed action should always be present for edit operations."
                );
            }
            const currentAction = op.observed.action;

            await writeOpenAction(ctx, op.desired, {
                current: currentAction,
                itemRegistry,
                pathPrefix: srcPath ?? undefined,
                onProgress: applyProgress?.nestedSink() ?? progress,
            });
            if (applyProgress !== null) {
                appliedBudget = Math.max(appliedBudget, applyProgress.getAppliedBudget());
            }
            await clickGoBack(ctx);
        }

        await setListItemNote(ctx, actionSlot, op.desired.note);
        appliedBudget += operationApplyBudget(op, desired.length);
        if (sink !== null && srcPath !== null) sink.completeOp(srcPath, "edit");
    }

    moves.sort((a, b) => a.toIndex - b.toIndex);
    for (const op of moves) {
        const fromIndex = remainingObserved.indexOf(op.observed);
        if (fromIndex === -1) {
            continue;
        }

        const srcIdx = srcIndexForOp(op, desired);
        const srcPath = srcIdx >= 0 ? actionPathForIndex(pathPrefix, srcIdx) : null;
        if (sink !== null && srcPath !== null) sink.beginOp(srcPath, "move", opLabel(op));
        emitApplying(opLabel(op), appliedOps, appliedBudget);
        appliedOps++;

        await moveActionToIndex(ctx, fromIndex, op.toIndex, remainingObserved.length);
        appliedBudget += operationApplyBudget(op, desired.length);

        remainingObserved.splice(fromIndex, 1);
        remainingObserved.splice(op.toIndex, 0, op.observed);
        for (let i = 0; i < remainingObserved.length; i++) {
            remainingObserved[i].index = i;
        }
        if (sink !== null && srcPath !== null) sink.completeOp(srcPath, "match");
    }

    adds.sort((a, b) => a.toIndex - b.toIndex);
    let currentLength = remainingObserved.length;
    for (const op of adds) {
        const srcIdx = srcIndexForOp(op, desired);
        const srcPath = srcIdx >= 0 ? actionPathForIndex(pathPrefix, srcIdx) : null;
        if (sink !== null && srcPath !== null) sink.beginOp(srcPath, "add", opLabel(op));
        emitApplying(opLabel(op), appliedOps, appliedBudget);
        appliedOps++;

        const actionToImport =
            op.desired.note === undefined
                ? op.desired
                : ({ ...op.desired, note: undefined } as Action);

        await importAction(
            ctx,
            actionToImport,
            itemRegistry,
            applyProgress?.nestedSink() ?? progress,
            srcPath ?? undefined
        );
        if (applyProgress !== null) {
            appliedBudget = Math.max(appliedBudget, applyProgress.getAppliedBudget());
        }
        await moveActionToIndex(ctx, currentLength, op.toIndex, currentLength + 1);

        const insertedAction: ObservedActionSlot = {
            index: op.toIndex,
            slotId: -1,
            slot: null as never,
            action: op.desired,
        };
        remainingObserved.splice(op.toIndex, 0, insertedAction);
        currentLength += 1;
        for (let i = 0; i < remainingObserved.length; i++) {
            remainingObserved[i].index = i;
        }

        if (op.desired.note !== undefined) {
            const addedSlot = await getPaginatedListSlotAtIndex(ctx, op.toIndex, currentLength, ACTION_LIST_CONFIG);
            await setListItemNote(ctx, addedSlot, op.desired.note);
        }
        appliedBudget += operationApplyBudget(op, desired.length);
        if (sink !== null && srcPath !== null) sink.completeOp(srcPath, "add");
    }

    await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);
    emitApplying("applied action diff", diff.operations.length, appliedBudget);

    if (sink !== null) sink.end();
    } finally {
        setCurrentPhase(null);
    }
}
