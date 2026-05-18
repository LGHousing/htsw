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
} from "../gui/helpers";
import { MouseButton } from "../../tasks/specifics/slots";
import type {
    ActionListDiff,
    ActionListOperation,
    Observed,
    ObservedActionSlot,
} from "../types";
import type { ActionListProgressSink } from "../progress/types";
import { createApplyProgressAdapter } from "../progress/nested";
import {
    getPaginatedListSlotAtIndex,
    goToPaginatedListPage,
} from "../gui/paginatedList";
import {
    getActiveDiffSink,
    type ImportDiffSink,
    type DiffSummary,
} from "../diffSink";
import {
    COST,
    actionOperationApplyUnits,
    actionListDiffApplyUnits,
    conditionListDiffApplyUnits,
    phaseUnitsFromParts,
    scalarFieldEditUnitsForOp,
    type ActionListPhaseUnits,
} from "../progress/costs";
import { timed } from "../progress/timing";
import { ACTION_LIST_CONFIG } from "./listConfig";
import {
    actionPathForIndex,
    getActionSpec,
    writeOpenAction,
} from "../actions";
import { actionLogLabel, editDiffSummary } from "./log";

type LiveActionListEntry = {
    entryId: number;
    action: Observed<Action> | null;
};

async function importAction(
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
    phaseUnits?: ActionListPhaseUnits
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
        phaseUnits
    );
}

function recomputeTotal(b: ActionListPhaseUnits): number {
    return b.readPart + b.hydratePart + b.applyPart;
}

function desiredIndexForOp(op: ActionListOperation): number {
    if (op.kind === "add" || op.kind === "edit") return op.desiredIndex;
    if (op.kind === "move") return op.toIndex;
    return -1;
}

function opLabel(op: ActionListOperation): string {
    if (op.kind === "delete") return `delete ${actionLogLabel(op.currentAction)}`;
    if (op.kind === "edit") return `edit → ${actionLogLabel(op.desired)}`;
    if (op.kind === "move") return `move ${actionLogLabel(op.action)} → #${op.toIndex + 1}`;
    return `add ${actionLogLabel(op.desired)}`;
}

function opDetail(op: ActionListOperation): string {
    if (op.kind === "edit") return editDiffSummary(op);
    if (op.kind === "move") return `#${op.fromIndex + 1} -> #${op.toIndex + 1}`;
    if (op.kind === "add") return "add source action";
    return "delete Housing-only action";
}

function editOperationFieldUnits(
    op: Extract<ActionListOperation, { kind: "edit" }>
): number {
    let total = scalarFieldEditUnitsForOp(op);
    for (const nested of op.nestedDiffs) {
        if (nested.diff.operations.length === 0) continue;
        total += COST.menuClickWait + COST.goBackWait;
        if (nested.prop === "conditions") {
            total += conditionListDiffApplyUnits(nested.diff);
        } else {
            total += actionListDiffApplyUnits(
                nested.diff,
                editOperationFieldUnits,
                nested.diff.desiredLength
            );
        }
    }
    return total;
}

function operationApplyUnits(op: ActionListOperation, desiredLength: number): number {
    return actionOperationApplyUnits(op, editOperationFieldUnits, desiredLength);
}

function findCurrentIndex(
    remaining: readonly LiveActionListEntry[],
    entryId: number
): number {
    for (let i = 0; i < remaining.length; i++) {
        if (remaining[i].entryId === entryId) return i;
    }
    return -1;
}

function summarizeDiff(
    diff: ActionListDiff,
    desiredLength: number
): DiffSummary {
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

async function applyActionListDiffInner(
    ctx: TaskContext,
    observed: ObservedActionSlot[],
    desired: Action[],
    diff: ActionListDiff,
    sink: ImportDiffSink | null,
    itemRegistry?: ItemRegistry,
    progress?: ActionListProgressSink,
    pathPrefix?: string,
    phaseUnits?: ActionListPhaseUnits
): Promise<void> {
    const summary = summarizeDiff(diff, desired.length);
    const plannedApplyUnits = actionListDiffApplyUnits(
        diff,
        editOperationFieldUnits,
        desired.length
    );
    if (phaseUnits !== undefined) {
        phaseUnits.applyPart = Math.max(plannedApplyUnits, 1);
        phaseUnits.total = recomputeTotal(phaseUnits);
    }
    const baseline = phaseUnits !== undefined
        ? phaseUnits.readPart + phaseUnits.hydratePart
        : 0;
    const applyProgress =
        phaseUnits === undefined
            ? null
            : createApplyProgressAdapter({
                  phaseUnits,
                  unitTotal: Math.max(1, diff.operations.length),
                  baseline,
                  sink: progress,
              });
    if (sink !== null) {
        sink.summary(summary);
        sink.phase("computed diff");
        for (const op of diff.operations) {
            const idx = desiredIndexForOp(op);
            if (idx >= 0) {
                sink.planOp(actionPathForIndex(pathPrefix, idx), op.kind, opLabel(op), opDetail(op));
            } else if (op.kind === "delete") {
                sink.deleteOp(op.fromIndex, opLabel(op), opDetail(op));
            }
        }
    }
    const diffLabel =
        `${summary.edits} edits · ${summary.adds} adds · ${summary.deletes} deletes · ${summary.moves} moves`;
    if (phaseUnits !== undefined) {
        progress?.({
            phase: "applying",
            phaseLabel: diffLabel,
            unitCompleted: 1,
            unitTotal: 1,
            completedUnits: baseline,
            totalUnits: phaseUnits.total,
            phaseUnits: phaseUnitsFromParts(phaseUnits),
        });
    } else {
        progress?.({
            phase: "applying",
            phaseLabel: diffLabel,
            unitCompleted: 1,
            unitTotal: 1,
            completedUnits: 0,
            totalUnits: plannedApplyUnits,
            phaseUnits: {
                reading: 0,
                hydrating: 0,
                applying: plannedApplyUnits,
            },
        });
    }
    // Pre-mark already-matching desired actions. Anything not touched by an
    // op is "match" (white) from the start; ops will paint their own state
    // on completion.
    if (sink !== null) {
        const touched = new Set<number>();
        for (const op of diff.operations) {
            const idx = desiredIndexForOp(op);
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
                completedUnits: applied,
                totalUnits: plannedApplyUnits,
                phaseUnits: {
                    reading: 0,
                    hydrating: 0,
                    applying: plannedApplyUnits,
                },
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

    let appliedUnits = 0;
    let nextRuntimeEntryId = observed.length;
    const remaining: LiveActionListEntry[] = [];
    for (let i = 0; i < observed.length; i++) {
        remaining.push({
            entryId: i,
            action: observed[i].action,
        });
    }

    // Deletes first (reverse order so indices stay valid), then refresh slot refs.
    if (deletes.length > 0) {
        deletes.sort((a, b) => b.fromIndex - a.fromIndex);

        for (let i = 0; i < deletes.length; i++) {
            const op = deletes[i];
            const index = findCurrentIndex(remaining, op.entryId);
            if (index === -1) {
                continue;
            }

            emitApplying(opLabel(op), i, appliedUnits);
            if (sink !== null) sink.phase(opLabel(op));
            await deleteObservedAction(ctx, index, remaining.length);
            appliedUnits += operationApplyUnits(op, desired.length);
            remaining.splice(index, 1);
        }
    }

    // Edits before moves keep current entry positions stable while editors open.
    let appliedOps = deletes.length;
    for (const op of edits) {
        const currentIndex = findCurrentIndex(remaining, op.entryId);
        if (currentIndex === -1) {
            continue;
        }

        const srcIdx = desiredIndexForOp(op);
        const srcPath = srcIdx >= 0 ? actionPathForIndex(pathPrefix, srcIdx) : null;
        if (sink !== null && srcPath !== null) sink.beginOp(srcPath, "edit", opLabel(op));
        emitApplying(opLabel(op), appliedOps, appliedUnits);
        appliedOps++;
        const opStartUnits = appliedUnits;

        const actionSlot = await getPaginatedListSlotAtIndex(
            ctx,
            currentIndex,
            remaining.length,
            ACTION_LIST_CONFIG
        );

        if (op.noteOnly) {
            await setListItemNote(ctx, actionSlot, op.desired.note);
            appliedUnits += operationApplyUnits(op, desired.length);
            remaining[currentIndex].action = op.desired;
            if (sink !== null && srcPath !== null) sink.completeOp(srcPath, "edit");
            continue;
        }

        const spec = getActionSpec(op.desired.type);
        if (spec.write) {
            actionSlot.click();
            await timedWaitForMenu(ctx, "menuClickWait");

            const currentAction = op.currentAction;

            await writeOpenAction(ctx, op.desired, {
                current: currentAction,
                itemRegistry,
                pathPrefix: srcPath ?? undefined,
                onProgress:
                    applyProgress?.nestedSink({
                        label: opLabel(op),
                        unitCompleted: appliedOps,
                        unitTotal: diff.operations.length,
                    }) ?? progress,
            });
            if (applyProgress !== null) {
                appliedUnits = Math.max(appliedUnits, applyProgress.getAppliedUnits());
            }
            await clickGoBack(ctx);
        }

        await setListItemNote(ctx, actionSlot, op.desired.note);
        appliedUnits = Math.max(
            appliedUnits,
            opStartUnits + operationApplyUnits(op, desired.length)
        );
        remaining[currentIndex].action = op.desired;
        if (sink !== null && srcPath !== null) sink.completeOp(srcPath, "edit");
    }

    moves.sort((a, b) => a.toIndex - b.toIndex);
    for (const op of moves) {
        const fromIndex = findCurrentIndex(remaining, op.entryId);
        if (fromIndex === -1) {
            continue;
        }

        const srcIdx = desiredIndexForOp(op);
        const srcPath = srcIdx >= 0 ? actionPathForIndex(pathPrefix, srcIdx) : null;
        if (sink !== null && srcPath !== null) sink.beginOp(srcPath, "move", opLabel(op));
        emitApplying(opLabel(op), appliedOps, appliedUnits);
        appliedOps++;

        await moveActionToIndex(ctx, fromIndex, op.toIndex, remaining.length);
        appliedUnits += operationApplyUnits(op, desired.length);

        const entry = remaining[fromIndex];
        remaining.splice(fromIndex, 1);
        remaining.splice(op.toIndex, 0, entry);
        if (sink !== null && srcPath !== null) sink.completeOp(srcPath, "match");
    }

    adds.sort((a, b) => a.toIndex - b.toIndex);
    let currentLength = remaining.length;
    for (const op of adds) {
        const srcIdx = desiredIndexForOp(op);
        const srcPath = srcIdx >= 0 ? actionPathForIndex(pathPrefix, srcIdx) : null;
        if (sink !== null && srcPath !== null) sink.beginOp(srcPath, "add", opLabel(op));
        emitApplying(opLabel(op), appliedOps, appliedUnits);
        appliedOps++;
        const opStartUnits = appliedUnits;

        const actionToImport =
            op.desired.note === undefined
                ? op.desired
                : ({ ...op.desired, note: undefined } as Action);

        await importAction(
            ctx,
            actionToImport,
            itemRegistry,
            applyProgress?.nestedSink({
                label: opLabel(op),
                unitCompleted: appliedOps,
                unitTotal: diff.operations.length,
            }) ?? progress,
            srcPath ?? undefined
        );
        if (applyProgress !== null) {
            appliedUnits = Math.max(appliedUnits, applyProgress.getAppliedUnits());
        }
        await moveActionToIndex(ctx, currentLength, op.toIndex, currentLength + 1);

        remaining.splice(op.toIndex, 0, {
            entryId: nextRuntimeEntryId++,
            action: op.desired,
        });
        currentLength += 1;

        if (op.desired.note !== undefined) {
            const addedSlot = await getPaginatedListSlotAtIndex(ctx, op.toIndex, currentLength, ACTION_LIST_CONFIG);
            await setListItemNote(ctx, addedSlot, op.desired.note);
        }
        appliedUnits = Math.max(
            appliedUnits,
            opStartUnits + operationApplyUnits(op, desired.length)
        );
        if (sink !== null && srcPath !== null) sink.completeOp(srcPath, "add");
    }

    await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);

    if (sink !== null) sink.end();
}
