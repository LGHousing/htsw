/**
 * Mutates a Housing action list to match a desired list, given a precomputed
 * diff. Includes `importAction` (single-action add) because the `adds` loop
 * is its only caller.
 *
 * Module graph note: this file imports `writeOpenAction`,
 * `withWritingActionPath`, `actionPathForIndex`, `getActionSpec`, and
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
    ActionListProgressSink,
    ObservedActionSlot,
} from "../types";
import {
    getPaginatedListSlotAtIndex,
    goToPaginatedListPage,
} from "../paginatedList";
import {
    getActiveDiffSink,
    type ImportDiffSink,
    type DiffSummary,
} from "../diffSink";
import { waitIfStepPaused } from "../stepGate";
import {
    COST,
    actionListDiffApplyBudget,
    moveBudget,
    scalarFieldEditBudget,
} from "../progress/costs";
import { timed } from "../progress/timing";
import { ACTION_LIST_CONFIG } from "./listConfig";
import {
    actionPathForIndex,
    getActionSpec,
    withWritingActionPath,
    writeOpenAction,
} from "../actions";
import { actionLogLabel, editDiffSummary } from "./log";

export async function importAction(
    ctx: TaskContext,
    action: Action,
    itemRegistry?: ItemRegistry
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
        await writeOpenAction(ctx, action, undefined, itemRegistry);
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
    pathPrefix?: string
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
        pathPrefix
    );
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
    pathPrefix?: string
): Promise<void> {
    const summary = summarizeDiff(diff, desired.length, desired);
    const plannedApplyBudget = actionListDiffApplyBudget(
        diff,
        editOperationFieldBudget,
        desired.length
    );
    // Morph events touch the live preview's line list. They fire at
    // EVERY level — top-level AND nested CONDITIONAL/RANDOM bodies —
    // so the inner adds/edits/deletes animate one-by-one too. The
    // pending-add line ids carry an `__add::` prefix (see
    // markPlannedAdd) which keeps them from colliding with observed
    // lines at the same actionPath (e.g. observed had b at index 1,
    // desired wants d at index 1; the diff plans both a delete on b
    // and an add on d, both keyed `<pathPrefix>.1`). Apply order is
    // delete → edit → move → add, so by the time the add applies and
    // the prefix is stripped, the observed-pending-delete line is
    // already gone — no id collision at the final step.
    //
    // The TOP-LEVEL-only event is `finalizeSource`, gated below by
    // `pathPrefix === undefined`. It rebuilds the whole model from
    // the desired tree at the very end.
    if (sink !== null) {
        sink.summary(summary);
        sink.phase("computed diff");
        for (const op of diff.operations) {
            const idx = srcIndexForOp(op, desired);
            if (idx >= 0) {
                const srcPath = actionPathForIndex(pathPrefix, idx);
                sink.planOp(srcPath, op.kind, opLabel(op), opDetail(op));
                // Edit ops carry the in-Housing "before" action; hand it
                // to the UI for side-by-side rendering. The Observed<Action>
                // may have null nested children — the renderer catches print
                // failures and falls back to no preview line.
                if (op.kind === "edit" && sink.planEditWithObserved) {
                    const observed = op.observed.action;
                    if (observed !== null) {
                        sink.planEditWithObserved(
                            srcPath,
                            observed as unknown as Action
                        );
                    }
                }
                if (op.kind === "add" && sink.planAdd) {
                    sink.planAdd(srcPath, op.desired, op.toIndex);
                } else if (op.kind === "edit" && !op.noteOnly && sink.planEdit) {
                    // Skip noteOnly edits — note-only changes have no
                    // visible body diff, so a ghost line would just be
                    // a duplicate of the original.
                    //
                    // Use the OBSERVED path, not the desired-index
                    // srcPath. Reason: when the diff matcher emits an
                    // edit + move combo (observed[i] matches desired[j]
                    // with i ≠ j), the model line lives at obsPath
                    // (i, where the observed read placed it), not at
                    // srcPath (j, where desired wants it). The move op
                    // handles the reorder separately.
                    const observedAction = op.observed.action;
                    if (observedAction !== null) {
                        const obsPath = actionPathForIndex(pathPrefix, op.observed.index);
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
                        sink.planEdit(obsPath, observedAction as unknown as Action, op.desired);
                    }
                } else if (op.kind === "move" && sink.planMove) {
                    // Use OBSERVED path (where the model line actually
                    // lives), not the desired toIndex path — markPlanned-
                    // Move marks the line at this path, and the line at
                    // toIndex is some other observed action, not the one
                    // being moved.
                    const obsPath = actionPathForIndex(pathPrefix, op.observed.index);
                    sink.planMove(obsPath, op.observed.index, op.toIndex);
                }
            } else if (op.kind === "delete") {
                sink.deleteOp(op.observed.index, opLabel(op), opDetail(op));
                if (sink.planDelete) {
                    const observedAction = op.observed.action;
                    if (observedAction !== null) {
                        // Use the observed action's REAL model path so
                        // the preview can find and mark the line. The
                        // model was built from the observed tree, so a
                        // line at this path exists.
                        const obsPath = actionPathForIndex(pathPrefix, op.observed.index);
                        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
                        sink.planDelete(obsPath, observedAction as unknown as Action);
                    }
                }
            }
        }
    }
    progress?.({
        phase: "diffing",
        completed: 1,
        total: 1,
        label: `${summary.edits} edits · ${summary.adds} adds · ${summary.deletes} deletes · ${summary.moves} moves`,
        estimatedCompleted: 0,
        estimatedTotal: plannedApplyBudget,
        confidence: "planned",
    });

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
        if (sink !== null && pathPrefix === undefined) {
            // end() clears currentPath + focusLineId. Firing it from
            // nested applyDiff would blink the cursor off every time a
            // nested CONDITIONAL/RANDOM finished its inner sync, even
            // though the outer apply is still in flight. Top-level only.
            if (sink.finalizeSource !== undefined) {
                sink.finalizeSource(desired);
            }
            sink.end();
        }
        return;
    }

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

            const obsPath = actionPathForIndex(pathPrefix, op.observed.index);
            await waitIfStepPaused(ctx);
            progress?.({
                phase: "applying",
                completed: i,
                total: diff.operations.length,
                label: opLabel(op),
                estimatedCompleted: appliedBudget,
                estimatedTotal: plannedApplyBudget,
                confidence: "planned",
            });
            // beginOp drives the cursor (▶ + autoscroll) onto the line
            // about to be deleted. Without this the cursor would stay
            // parked on the previous op while the user watches a delete
            // happen elsewhere — confusing in step-debug mode.
            if (sink !== null) sink.beginOp(obsPath, "delete", opLabel(op));
            await deleteObservedAction(ctx, index, currentObserved.length);
            appliedBudget += operationApplyBudget(op, desired.length);
            currentObserved.splice(index, 1);
            if (sink !== null) {
                sink.completeOp(obsPath, "delete");
                if (sink.applyDone !== undefined) {
                    sink.applyDone(obsPath, "delete", "delete");
                }
            }
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

        await waitIfStepPaused(ctx);
        // Use OBSERVED path so the cursor lands on the actual model
        // line (the observed entry being edited), not on the desired
        // index — important when edit + move combine and observed.index
        // differs from desired.index. The model line is at obsPath.
        const srcPath: string | null = actionPathForIndex(pathPrefix, op.observed.index);
        if (sink !== null) sink.beginOp(srcPath, "edit", opLabel(op));
        progress?.({
            phase: "applying",
            completed: appliedOps,
            total: diff.operations.length,
            label: opLabel(op),
            estimatedCompleted: appliedBudget,
            estimatedTotal: plannedApplyBudget,
            confidence: "planned",
        });
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
            if (sink !== null && srcPath !== null) {
                sink.completeOp(srcPath, "edit");
                // Note-only edits don't insert a ghost (planEdit was
                // skipped for them) — no morph to finalize.
            }
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

            await withWritingActionPath(srcPath, () =>
                writeOpenAction(ctx, op.desired, currentAction, itemRegistry)
            );
            await clickGoBack(ctx);
        }

        await setListItemNote(ctx, actionSlot, op.desired.note);
        appliedBudget += operationApplyBudget(op, desired.length);
        if (sink !== null && srcPath !== null) {
            sink.completeOp(srcPath, "edit");
            sink.applyDone?.(srcPath, "edit", "edit");
        }
    }

    moves.sort((a, b) => a.toIndex - b.toIndex);
    for (const op of moves) {
        const fromIndex = remainingObserved.indexOf(op.observed);
        if (fromIndex === -1) {
            continue;
        }

        await waitIfStepPaused(ctx);
        // Cursor on the line being moved (its OBSERVED model path),
        // not the destination index — the model line at toIndex is some
        // other observed action.
        const srcPath: string | null = actionPathForIndex(pathPrefix, op.observed.index);
        if (sink !== null) sink.beginOp(srcPath, "move", opLabel(op));
        progress?.({
            phase: "applying",
            completed: appliedOps,
            total: diff.operations.length,
            label: opLabel(op),
            estimatedCompleted: appliedBudget,
            estimatedTotal: plannedApplyBudget,
            confidence: "planned",
        });
        appliedOps++;

        await moveActionToIndex(ctx, fromIndex, op.toIndex, remainingObserved.length);
        appliedBudget += operationApplyBudget(op, desired.length);

        remainingObserved.splice(fromIndex, 1);
        remainingObserved.splice(op.toIndex, 0, op.observed);
        for (let i = 0; i < remainingObserved.length; i++) {
            remainingObserved[i].index = i;
        }
        if (sink !== null && srcPath !== null) {
            sink.completeOp(srcPath, "match");
            sink.applyDone?.(srcPath, "match", "move");
        }
    }

    adds.sort((a, b) => a.toIndex - b.toIndex);
    let currentLength = remainingObserved.length;
    for (const op of adds) {
        await waitIfStepPaused(ctx);
        const srcIdx = srcIndexForOp(op, desired);
        const srcPath = srcIdx >= 0 ? actionPathForIndex(pathPrefix, srcIdx) : null;
        if (sink !== null && srcPath !== null) sink.beginOp(srcPath, "add", opLabel(op));
        progress?.({
            phase: "applying",
            completed: appliedOps,
            total: diff.operations.length,
            label: opLabel(op),
            estimatedCompleted: appliedBudget,
            estimatedTotal: plannedApplyBudget,
            confidence: "planned",
        });
        appliedOps++;

        const actionToImport =
            op.desired.note === undefined
                ? op.desired
                : ({ ...op.desired, note: undefined } as Action);

        await withWritingActionPath(srcPath, () => importAction(ctx, actionToImport, itemRegistry));
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
        if (sink !== null && srcPath !== null) {
            sink.completeOp(srcPath, "add");
            sink.applyDone?.(srcPath, "add", "add");
        }
    }

    await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);
    progress?.({
        phase: "applying",
        completed: diff.operations.length,
        total: diff.operations.length,
        label: "applied action diff",
        estimatedCompleted: plannedApplyBudget,
        estimatedTotal: plannedApplyBudget,
        confidence: "planned",
    });

    if (sink !== null && pathPrefix === undefined) {
        // Top-level only: finalize from source + clear cursor. Nested
        // applyDiff returns silently — sink.end() would blink the
        // cursor off mid-import (see early-return branch above).
        if (sink.finalizeSource !== undefined) {
            sink.finalizeSource(desired);
        }
        sink.end();
    }
}
