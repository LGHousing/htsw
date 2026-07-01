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
} from "../gui/menuUtils";
import { timedWaitForMenu, waitForMenu } from "../gui/menuWait";
import { MouseButton, menuStateDescription } from "../../tasks/specifics/slots";
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
    SyncEventHandler,
    PlannedOp,
    ProgressScope,
} from "../syncEvents";
import { actionPathForIndex } from "../syncEvents";
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
    getActionSpec,
    writeOpenAction,
} from "./specs";
import { waitIfStepPaused } from "../stepGate";
import { getActionScalarLoreFields } from "../fields/actionMappings";
import { scalarFieldDiffers } from "../fields/compare";
import {
    createActionApplyContext,
    type ActionApplyContext,
    type ApplyNestedActionList,
} from "../context/actionApplyContext";
import {
    appendConditionsToOpenConditionList,
    applyConditionList,
} from "./conditions/applyDiff";
import {
    prereadActionList,
    type ActionListPlan,
    type ActionListApplyOptions,
    type ActionListPrereadOptions,
} from "./plan";

type LiveActionListEntry = {
    entryId: number;
    action: Observed<Action> | null;
};

type ImportActionCallbacks = {
    onActionAdded?: () => void;
    onNoteApplied?: () => void;
};

function actionWithNote(action: Action, note: string | undefined): Action {
    return note === action.note ? action : { ...action, note };
}

async function addAction(
    ctx: TaskContext,
    action: Action,
    itemRegistry: ItemRegistry,
    apply?: ActionApplyContext,
    callbacks?: ImportActionCallbacks
): Promise<void> {
    ctx.getMenuItemSlot("Add Action").click();
    await timedWaitForMenu(ctx, "menuClickWait");

    const spec = getActionSpec(action.type);
    const displayName = spec.displayName;

    await clickAddActionOption(ctx, action.type, displayName);
    if (!spec.write) {
        callbacks?.onActionAdded?.();
    }

    if (spec.write) {
        await writeOpenAction(ctx, action, {
            itemRegistry,
            apply,
        });
        await clickGoBack(ctx);
        callbacks?.onActionAdded?.();
    }

    await setNoteOnLastVisibleSlot(ctx, action.note, {
        onApplied: callbacks?.onNoteApplied,
    });
}

function createAppendOnlyActionApplyContext(
    ctx: TaskContext,
    itemRegistry: ItemRegistry
): ActionApplyContext {
    return {
        markHeaderApplied: () => undefined,

        async applyNestedActions(_prop, args) {
            await appendActionsToOpenActionList(ctx, args.desired, itemRegistry);
        },

        async applyNestedConditions(_prop, args) {
            await appendConditionsToOpenConditionList(
                ctx,
                args.desired,
                itemRegistry
            );
        },
    };
}

export async function appendActionsToOpenActionList(
    ctx: TaskContext,
    desired: Action[],
    itemRegistry: ItemRegistry
): Promise<void> {
    const apply = createAppendOnlyActionApplyContext(ctx, itemRegistry);
    for (let i = 0; i < desired.length; i++) {
        await addAction(ctx, desired[i], itemRegistry, apply);
    }
    if (desired.length > 0) {
        await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);
    }
}

async function clickAddActionOption(
    ctx: TaskContext,
    actionType: Action["type"],
    displayName: string
): Promise<void> {
    const slot = await getSlotPaginate(ctx, displayName);

    if (isLimitExceeded(slot, "action")) {
        throw Diagnostic.error(`Maximum amount of ${displayName} actions exceeded`);
    }

    const wait = timedWaitForMenu(ctx, "menuClickWait");
    slot.click();
    try {
        await wait;
    } catch (error) {
        throw new Error(
            `After clicking Add Action option "${displayName}" (${actionType})${menuStateDescription()}: ${errorMessage(error)}`
        );
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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

export async function applyActionListPlan(
    ctx: TaskContext,
    plan: ActionListPlan,
    options: ActionListApplyOptions
): Promise<void> {
    const progressScope: ProgressScope = options.progressScope ?? { kind: "topLevel" };
    const events = options.session.events;
    await applyActionListPlanInner(
        ctx,
        plan.observed,
        plan.desired,
        plan.diff,
        options.session.items,
        options.session,
        options.listPath,
        plan.phaseUnits,
        events ?? null,
        progressScope,
        (readCurrent) => {
            plan.getLiveCurrent = readCurrent;
        },
        applyNestedActionList
    );
}

async function applyNestedActionList(
    ctx: TaskContext,
    desired: Action[],
    options: ActionListPrereadOptions
): Promise<void> {
    const plan = await prereadActionList(ctx, desired, options);
    await applyActionListPlan(ctx, plan, options);
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
    current: readonly LiveActionListEntry[],
    entryId: number
): number {
    for (let i = 0; i < current.length; i++) {
        if (current[i].entryId === entryId) return i;
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
    events: SyncEventHandler | null | undefined,
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

async function applyActionListPlanInner(
    ctx: TaskContext,
    observed: ObservedActionSlot[],
    desired: Action[],
    diff: ActionListDiff,
    itemRegistry: ItemRegistry,
    session: ActionListApplyOptions["session"],
    listPath?: ActionPath,
    phaseUnits?: PhaseUnits,
    events?: SyncEventHandler | null,
    progressScope: ProgressScope = { kind: "topLevel" },
    onSnapshot?: (readCurrent: () => Array<Action | null>) => void,
    applyNestedActions?: ApplyNestedActionList
): Promise<void> {
    const isTopLevel = listPath === undefined;
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
                const srcPath = actionPathForIndex(listPath, idx);
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
                const obsPath = actionPathForIndex(listPath, op.fromIndex);
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
            if (!touched.has(i)) matches.push(actionPathForIndex(listPath, i));
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
    const current: LiveActionListEntry[] = [];
    for (let i = 0; i < observed.length; i++) {
        current.push({
            entryId: i,
            action: observed[i].action,
        });
    }

    const emitSnapshot = (): void => {
        onSnapshot?.(() => current.map((entry) => entry.action as Action | null));
    };
    const updateCurrentAction = (index: number, action: Observed<Action>): void => {
        current[index].action = action;
        emitSnapshot();
    };
    emitSnapshot();

    if (deletes.length > 0) {
        deletes.sort((a, b) => b.fromIndex - a.fromIndex);

        for (let i = 0; i < deletes.length; i++) {
            const op = deletes[i];
            const index = findCurrentIndex(current, op.entryId);
            if (index === -1) {
                continue;
            }

            if (isTopLevel) await waitIfStepPaused(ctx);
            const obsPath = actionPathForIndex(listPath, op.fromIndex);
            await deleteObservedAction(ctx, index, current.length);
            appliedUnits += operationApplyUnits(op, desired.length);
            current.splice(index, 1);
            emitSnapshot();
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

    for (const op of edits) {
        const currentIndex = findCurrentIndex(current, op.entryId);
        if (currentIndex === -1) {
            continue;
        }

        const srcIdx = desiredIndexForOp(op);
        const srcPath = srcIdx >= 0 ? actionPathForIndex(listPath, srcIdx) : null;
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
            current.length,
            ACTION_LIST_CONFIG
        );

        if (op.noteOnly) {
            let snapshotUpdated = false;
            const updateSnapshot = (): void => {
                updateCurrentAction(currentIndex, op.desired);
                snapshotUpdated = true;
            };
            await setListItemNote(ctx, actionSlot, op.desired.note, {
                onApplied: updateSnapshot,
            });
            appliedUnits += operationApplyUnits(op, desired.length);
            if (!snapshotUpdated) updateSnapshot();
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
        const actionWithCurrentNote = (): Action => actionWithNote(op.desired, op.baselineAction.note);
        let desiredSnapshotUpdated = false;
        const updateEditSnapshot = (action: Observed<Action>, isDesired: boolean): void => {
            updateCurrentAction(currentIndex, action);
            if (isDesired) desiredSnapshotUpdated = true;
        };
        if (spec.write) {
            actionSlot.click();
            await timedWaitForMenu(ctx, "menuClickWait");

            const baselineAction = op.baselineAction;
            const apply = srcPath === null || applyNestedActions === undefined
                ? undefined
                : createActionApplyContext({
                      ctx,
                      actionPath: srcPath,
                      session,
                      appliedUnits,
                      completedOps,
                      totalOps: diff.operations.length,
                      applyNestedActions,
                      applyNestedConditions: applyConditionList,
                  });

            await writeOpenAction(ctx, op.desired, {
                current: baselineAction,
                itemRegistry,
                apply,
            });
            updateEditSnapshot(actionWithCurrentNote(), false);
            await clickGoBack(ctx);
        }

        await setListItemNote(ctx, actionSlot, op.desired.note, {
            onApplied: () => updateEditSnapshot(op.desired, true),
        });
        appliedUnits = Math.max(
            appliedUnits,
            opStartUnits + operationApplyUnits(op, desired.length)
        );
        if (!desiredSnapshotUpdated) {
            updateEditSnapshot(op.desired, true);
        }
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
        const fromIndex = findCurrentIndex(current, op.entryId);
        if (fromIndex === -1) {
            continue;
        }

        const srcIdx = desiredIndexForOp(op);
        const srcPath = srcIdx >= 0 ? actionPathForIndex(listPath, srcIdx) : null;
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

        await moveActionToIndex(ctx, fromIndex, op.toIndex, current.length);
        appliedUnits += operationApplyUnits(op, desired.length);

        const entry = current[fromIndex];
        current.splice(fromIndex, 1);
        current.splice(op.toIndex, 0, entry);
        emitSnapshot();
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
    let currentLength = current.length;
    for (const op of adds) {
        const srcIdx = desiredIndexForOp(op);
        const srcPath = srcIdx >= 0 ? actionPathForIndex(listPath, srcIdx) : null;
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

        const actionToImport = actionWithNote(op.desired, undefined);

        let actionAdded = false;
        const updateAddedSnapshot = (): void => {
            if (actionAdded) return;
            current.push({
                entryId: nextRuntimeEntryId++,
                action: actionToImport,
            });
            emitSnapshot();
            actionAdded = true;
        };
        const apply = srcPath === null || applyNestedActions === undefined
            ? undefined
            : createActionApplyContext({
                  ctx,
                  actionPath: srcPath,
                  session,
                  appliedUnits,
                  completedOps,
                  totalOps: diff.operations.length,
                  applyNestedActions,
                  applyNestedConditions: applyConditionList,
              });
        await addAction(
            ctx,
            actionToImport,
            itemRegistry,
            apply,
            { onActionAdded: updateAddedSnapshot }
        );
        if (!actionAdded) updateAddedSnapshot();

        await moveActionToIndex(ctx, currentLength, op.toIndex, currentLength + 1);

        const addedEntry = current[currentLength];
        current.splice(currentLength, 1);
        current.splice(op.toIndex, 0, addedEntry);
        emitSnapshot();
        currentLength += 1;

        if (op.desired.note !== undefined) {
            const addedSlot = await getPaginatedListSlotAtIndex(ctx, op.toIndex, currentLength, ACTION_LIST_CONFIG);
            let noteSnapshotUpdated = false;
            const updateNoteSnapshot = (): void => {
                updateCurrentAction(op.toIndex, op.desired);
                noteSnapshotUpdated = true;
            };
            await setListItemNote(ctx, addedSlot, op.desired.note, {
                onApplied: updateNoteSnapshot,
            });
            if (!noteSnapshotUpdated) updateNoteSnapshot();
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
