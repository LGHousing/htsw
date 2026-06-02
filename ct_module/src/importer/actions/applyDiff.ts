/**
 * Mutates a Housing action list to match a desired list, given a precomputed
 * diff. Includes `importAction` (single-action add) because the `adds` loop
 * is its only caller.
 *
 * Module graph note: this file imports `writeOpenAction`,
 * `actionPathForIndex`, `getActionSpec` from `./specs`. The writers in
 * `./writers` reach back into `./sync` (which itself imports from this file)
 * for nested `syncActionList` calls. This is a function-reference cycle that
 * resolves fine at runtime — don't try to "fix" it by relocating
 * `writeOpenAction`.
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
} from "../gui/menuFlows";
import { timedWaitForMenu, waitForMenu } from "../gui/menuWait";
import { MouseButton } from "../../tasks/specifics/slots";
import type {
    ActionListDiff,
    ActionListOperation,
    Observed,
    ObservedActionSlot,
} from "../types";
import {
    getPaginatedListSlotAtIndex,
    goToPaginatedListPage,
} from "../gui/paginatedList";
import type {
    ActionPath,
    DiffSummary,
    ImportEventHandler,
    PlannedOp,
    ProgressScope,
} from "../importEvents";
import {
    COST,
    actionOperationApplyUnits,
    actionListDiffApplyUnits,
    editUnitsWithNested,
    phaseUnitsTotal,
    type PhaseUnits,
} from "../progress/costs";
import { timed } from "../progress/timing";
import { ACTION_LIST_CONFIG } from "./listConfig";
import {
    actionPathForIndex,
    getActionSpec,
    writeOpenAction,
} from "./specs";
import { waitIfStepPaused } from "../stepGate";
import { getActionScalarLoreFields } from "../fields/actionMappings";
import { scalarFieldDiffers } from "../fields/compare";

type LiveActionListEntry = {
    entryId: number;
    action: Observed<Action> | null;
};

async function importAction(
    ctx: TaskContext,
    action: Action,
    itemRegistry?: ItemRegistry,
    nestedProgressScope?: (path: ActionPath, extraOffset?: number) => ProgressScope | undefined,
    pathPrefix?: string,
    events?: ImportEventHandler
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
            nestedProgressScope,
            events,
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
    pathPrefix?: string,
    phaseUnits?: PhaseUnits,
    events?: ImportEventHandler,
    progressScope?: ProgressScope
): Promise<void> {
    await applyActionListDiffInner(
        ctx,
        observed,
        desired,
        diff,
        itemRegistry,
        pathPrefix,
        phaseUnits,
        events ?? null,
        progressScope ?? { kind: "topLevel" }
    );
}

function desiredIndexForOp(op: ActionListOperation): number {
    if (op.kind === "add" || op.kind === "edit") return op.desiredIndex;
    if (op.kind === "move") return op.toIndex;
    return -1;
}

function actionTypeForOp(op: ActionListOperation): Action["type"] | null {
    if (op.kind === "add" || op.kind === "edit") return op.desired.type;
    if (op.kind === "move") return op.action.type;
    return op.baselineAction?.type ?? null;
}

function fieldsChangedForEdit(
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
                fields.push(String(field.prop));
            }
        }
        for (let i = 0; i < op.nestedDiffs.length; i++) {
            const nested = op.nestedDiffs[i];
            if (nested.diff.operations.length > 0) fields.push(nested.prop);
        }
    }
    return fields;
}

function operationApplyUnits(op: ActionListOperation, desiredLength: number): number {
    return actionOperationApplyUnits(op, editUnitsWithNested, desiredLength);
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

function emitApplyProgress(
    events: ImportEventHandler | null | undefined,
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

function nestedApplyScope(
    parentActionPath: ActionPath,
    baselineApplyUnits: number,
    completedOps: number,
    totalOps: number
): (path: ActionPath, extraOffset?: number) => ProgressScope {
    // `extraOffset` lets a CONDITIONAL/RANDOM writer place each of its
    // sub-lists (conditions, ifActions, elseActions) at its own slice of the
    // op's apply budget — conditions at [base, base+condCost], ifActions
    // after, etc. — so their progress doesn't collide on the same baseline.
    return (path, extraOffset) => ({
        kind: "nestedActionList",
        path,
        parentActionPath,
        baselineApplyUnits: baselineApplyUnits + (extraOffset ?? 0),
        parentSync: {
            completedUnits: completedOps,
            totalUnits: totalOps,
        },
    });
}

async function applyActionListDiffInner(
    ctx: TaskContext,
    observed: ObservedActionSlot[],
    desired: Action[],
    diff: ActionListDiff,
    itemRegistry?: ItemRegistry,
    pathPrefix?: string,
    phaseUnits?: PhaseUnits,
    events?: ImportEventHandler | null,
    progressScope: ProgressScope = { kind: "topLevel" }
): Promise<void> {
    const isTopLevel = pathPrefix === undefined;
    const summary = summarizeDiff(diff, desired.length);
    const plannedApplyUnits = actionListDiffApplyUnits(
        diff,
        editUnitsWithNested,
        desired.length
    );
    if (phaseUnits !== undefined) {
        phaseUnits.applying = Math.max(plannedApplyUnits, 1);
    }
    const baseline = phaseUnits !== undefined
        ? phaseUnits.reading + phaseUnits.hydrating
        : 0;
    const fallbackPhaseUnits: PhaseUnits = {
        setup: 0,
        reading: 0,
        hydrating: 0,
        applying: plannedApplyUnits,
    };
    if (events != null) {
        const operations: PlannedOp[] = [];
        for (const op of diff.operations) {
            const idx = desiredIndexForOp(op);
            if (idx >= 0) {
                const srcPath = actionPathForIndex(pathPrefix, idx);
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
                const obsPath = actionPathForIndex(pathPrefix, op.fromIndex);
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
            if (!touched.has(i)) matches.push(actionPathForIndex(pathPrefix, i));
        }
        events.emit({ kind: "diffPlanned", summary, operations, matches });
    }
    emitApplyProgress(
        events,
        progressScope,
        phaseUnits ?? fallbackPhaseUnits,
        baseline,
        0,
        diff.operations.length
    );
    if (diff.operations.length === 0) {
        if (events != null && isTopLevel) {
            events.emit({ kind: "finalizeSource", actions: desired });
            events.emit({ kind: "listSyncCompleted" });
        }
        return;
    }

    const emitApplying = (completedOps: number, applied: number): void => {
        const activePhaseUnits = phaseUnits ?? fallbackPhaseUnits;
        emitApplyProgress(
            events,
            progressScope,
            activePhaseUnits,
            baseline + Math.min(applied, activePhaseUnits.applying),
            completedOps,
            diff.operations.length
        );
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
    let completedOps = 0;
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

            if (isTopLevel) await waitIfStepPaused(ctx);
            const obsPath = actionPathForIndex(pathPrefix, op.fromIndex);
            await deleteObservedAction(ctx, index, remaining.length);
            appliedUnits += operationApplyUnits(op, desired.length);
            remaining.splice(index, 1);
            completedOps++;
            emitApplying(completedOps, appliedUnits);
            if (events != null) {
                events.emit({
                    kind: "operationCompleted",
                    path: obsPath,
                    finalState: "delete",
                    op: "delete",
                    observedEntryId: op.entryId,
                });
            }
        }
    }

    // Edits before moves keep current entry positions stable while editors open.
    for (const op of edits) {
        const currentIndex = findCurrentIndex(remaining, op.entryId);
        if (currentIndex === -1) {
            continue;
        }

        const srcIdx = desiredIndexForOp(op);
        const srcPath = srcIdx >= 0 ? actionPathForIndex(pathPrefix, srcIdx) : null;
        if (events != null && srcPath !== null) {
            events.emit({
                kind: "operationStarted",
                path: srcPath,
                op: "edit",
                actionType: op.desired.type,
                fromIndex: op.fromIndex,
                toIndex: op.desiredIndex,
                fieldsChanged: fieldsChangedForEdit(op),
            });
        }
        if (isTopLevel) await waitIfStepPaused(ctx);
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
            completedOps++;
            emitApplying(completedOps, appliedUnits);
            if (events != null && srcPath !== null) {
                events.emit({
                    kind: "operationCompleted",
                    path: srcPath,
                    op: "edit",
                    finalState: "edit",
                });
            }
            continue;
        }

        const spec = getActionSpec(op.desired.type);
        if (spec.write) {
            actionSlot.click();
            await timedWaitForMenu(ctx, "menuClickWait");

            const baselineAction = op.baselineAction;

            await writeOpenAction(ctx, op.desired, {
                current: baselineAction,
                itemRegistry,
                pathPrefix: srcPath ?? undefined,
                nestedProgressScope:
                    srcPath === null
                        ? undefined
                        : nestedApplyScope(
                              srcPath,
                              appliedUnits,
                              completedOps,
                              diff.operations.length
                          ),
                events: events ?? undefined,
            });
            await clickGoBack(ctx);
        }

        await setListItemNote(ctx, actionSlot, op.desired.note);
        appliedUnits = Math.max(
            appliedUnits,
            opStartUnits + operationApplyUnits(op, desired.length)
        );
        remaining[currentIndex].action = op.desired;
        completedOps++;
        emitApplying(completedOps, appliedUnits);
        if (events != null && srcPath !== null) {
            events.emit({
                kind: "operationCompleted",
                path: srcPath,
                op: "edit",
                finalState: "edit",
            });
        }
    }

    moves.sort((a, b) => a.toIndex - b.toIndex);
    for (const op of moves) {
        const fromIndex = findCurrentIndex(remaining, op.entryId);
        if (fromIndex === -1) {
            continue;
        }

        const srcIdx = desiredIndexForOp(op);
        const srcPath = srcIdx >= 0 ? actionPathForIndex(pathPrefix, srcIdx) : null;
        if (events != null && srcPath !== null) {
            events.emit({
                kind: "operationStarted",
                path: srcPath,
                op: "move",
                actionType: op.action.type,
                fromIndex: op.fromIndex,
                toIndex: op.toIndex,
            });
        }
        if (isTopLevel) await waitIfStepPaused(ctx);

        await moveActionToIndex(ctx, fromIndex, op.toIndex, remaining.length);
        appliedUnits += operationApplyUnits(op, desired.length);

        const entry = remaining[fromIndex];
        remaining.splice(fromIndex, 1);
        remaining.splice(op.toIndex, 0, entry);
        completedOps++;
        emitApplying(completedOps, appliedUnits);
        if (events != null && srcPath !== null) {
            events.emit({
                kind: "operationCompleted",
                path: srcPath,
                op: "move",
                finalState: "match",
            });
        }
    }

    adds.sort((a, b) => a.toIndex - b.toIndex);
    let currentLength = remaining.length;
    for (const op of adds) {
        const srcIdx = desiredIndexForOp(op);
        const srcPath = srcIdx >= 0 ? actionPathForIndex(pathPrefix, srcIdx) : null;
        if (events != null && srcPath !== null) {
            events.emit({
                kind: "operationStarted",
                path: srcPath,
                op: "add",
                actionType: op.desired.type,
                toIndex: op.toIndex,
            });
        }
        if (isTopLevel) await waitIfStepPaused(ctx);
        const opStartUnits = appliedUnits;

        const actionToImport =
            op.desired.note === undefined
                ? op.desired
                : ({ ...op.desired, note: undefined } as Action);

        await importAction(
            ctx,
            actionToImport,
            itemRegistry,
            srcPath === null
                ? undefined
                : nestedApplyScope(
                      srcPath,
                      appliedUnits,
                      completedOps,
                      diff.operations.length
                  ),
            srcPath ?? undefined,
            events ?? undefined
        );
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
        completedOps++;
        emitApplying(completedOps, appliedUnits);
        if (events != null && srcPath !== null) {
            events.emit({
                kind: "operationCompleted",
                path: srcPath,
                op: "add",
                finalState: "add",
            });
        }
    }

    await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);

    if (events != null && isTopLevel) {
        events?.emit({ kind: "finalizeSource", actions: desired });
        events.emit({ kind: "listSyncCompleted" });
    }
}
