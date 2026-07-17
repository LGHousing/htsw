import type { Action } from "htsw/types";

import TaskContext from "../../../tasks/context";
import { isTaskCancelled } from "../../../tasks/manager";
import { clickGoBack } from "../../menus/menuUtils";
import { timedWaitForMenu } from "../../menus/menuWait";
import { captureItemFromOpenEditorField } from "../../itemCapture";
import { refreshTruncatedScalarFields } from "../readers";
import type { ActionHydrationPlan, ActionHydrationWork } from "./plan";
import type { ChildListName } from "../../actionPath";
import {
    observedSlotsToActions,
    presentChildListsContainNoNulls,
    type ObservedActionSlot,
} from "../../observedActions";
import type { ListReadOptions } from "../../context/actionReadContext";
import {
    getPaginatedListPageForIndex,
    getPaginatedListSlotAtIndex,
    goToPaginatedListPage,
} from "../../menus/paginatedList";
import { ActionPath } from "../../actionPath";
import { hydrationEntryUnits, phaseUnitsTotal } from "../../progress/costs";
import {
    createHydrationEntryAccount,
    type HydrationEntryAccount,
} from "../../progress/hydrationAccount";
import type { ProgressPayload } from "../../progress/types";
import { ACTION_LIST_CONFIG } from "../listConfigs";
import { getActionIo } from "../io";
import { createActionReadContext } from "../../context/actionReadContext";
import { readConditionList } from "../conditions/readList";
import {
    canonicalizeActionItemName,
    emitObservedSnapshot,
    scanActionList,
    type ActionListReadMode,
    type ActionListScan,
} from "../readList";

async function readActionList(
    ctx: TaskContext,
    mode: ActionListReadMode = { kind: "full" },
    read?: ListReadOptions
): Promise<ObservedActionSlot[]> {
    const scan = await scanActionList(ctx, mode, read);
    await hydrateActionListScan(ctx, scan, read);
    return scan.slots;
}

export async function completeActionListScan(
    ctx: TaskContext,
    scan: ActionListScan,
    read?: ListReadOptions
): Promise<Action[]> {
    await hydrateActionListScan(ctx, scan, read);
    return observedSlotsToActions(scan.slots);
}

export async function readActionListFully(
    ctx: TaskContext,
    read?: ListReadOptions
): Promise<Action[]> {
    const scan = await scanActionList(ctx, { kind: "full" }, read);
    return completeActionListScan(ctx, scan, read);
}

export async function hydrateActionListScan(
    ctx: TaskContext,
    scan: ActionListScan,
    read?: ListReadOptions
): Promise<void> {
    const { slots, plan, isRootList } = scan;
    await hydrateActionDetails(ctx, plan, slots, isRootList, read);
    await goToPaginatedListPage(ctx, 1, ACTION_LIST_CONFIG);
    if (read?.itemRegistry !== undefined) {
        for (const entry of slots) {
            if (entry.action !== null) {
                canonicalizeActionItemName(entry.action, read.itemRegistry);
            }
        }
    }
    if (isRootList) {
        emitObservedSnapshot(slots, read?.events);
    }
}

async function hydrateActionDetails(
    ctx: TaskContext,
    plan: ActionHydrationPlan,
    observed: readonly ObservedActionSlot[],
    isRootList: boolean = false,
    read?: ListReadOptions
): Promise<void> {
    const progress = read?.progress;
    const phaseUnits = read?.phaseUnits;
    const events = read?.events;
    const listPath = read?.listPath;
    let completed = 0;
    const total = plan.size;
    let completedHydrateUnits = 0;
    let totalHydrateUnits = 0;
    plan.forEach((work, entry) => {
        totalHydrateUnits += hydrationEntryUnits(
            entry,
            work,
            read?.exactHydrationEstimate !== true
        );
    });
    if (phaseUnits !== undefined) phaseUnits.hydrating = totalHydrateUnits;
    // The running entry's account replaces its lump-sum estimate with what
    // its child reads actually establish, payload by payload — `emit` folds
    // the live delta into the hydrate totals so the caller sees plan-derived
    // units the moment a child read builds its plan, not when the entry ends.
    let currentAccount: HydrationEntryAccount | null = null;
    let currentEntryEstimate = 0;
    const emit = () => {
        if (phaseUnits === undefined) return;
        const entryDelta =
            currentAccount === null
                ? 0
                : currentAccount.bookedUnits() - currentEntryEstimate;
        const entryCompleted =
            currentAccount === null ? 0 : currentAccount.completedUnits();
        phaseUnits.hydrating = totalHydrateUnits + entryDelta;
        progress?.({
            phase: "hydrating",
            completedUnits: phaseUnits.reading + completedHydrateUnits + entryCompleted,
            totalUnits: phaseUnitsTotal(phaseUnits),
            phaseUnits: phaseUnits,
            sync: { completedUnits: completed, totalUnits: total, parent: null },
        });
    };
    const subStepSnapshot =
        isRootList && events !== undefined
            ? () => emitObservedSnapshot(observed, events)
            : undefined;
    for (const [entry, work] of plan) {
        const entryPath = ActionPath.at(listPath, entry.index);
        currentEntryEstimate = hydrationEntryUnits(
            entry,
            work,
            read?.exactHydrationEstimate !== true
        );
        currentAccount = createHydrationEntryAccount(
            entry,
            work,
            emit,
            read?.exactHydrationEstimate !== true
        );
        emit();
        events?.emit({
            kind: "childListReadStarted",
            path: entryPath,
            actionType: entry.action?.type ?? null,
        });
        await hydrateActionDetail(
            ctx,
            entry,
            work,
            observed.length,
            read,
            entryPath,
            subStepSnapshot,
            currentAccount
        );
        const entryUnits = currentAccount.finish();
        totalHydrateUnits += entryUnits - currentEntryEstimate;
        completedHydrateUnits += entryUnits;
        currentAccount = null;
        completed++;
        emit();
        if (isRootList) {
            emitObservedSnapshot(observed, events);
            events?.emit({
                kind: "actionReadCompleted",
                path: entryPath,
                hydrated: true,
            });
        }
    }
}

async function hydrateActionDetail(
    ctx: TaskContext,
    entry: ObservedActionSlot,
    work: ActionHydrationWork,
    listLength: number,
    read: ListReadOptions | undefined,
    entryPath: ActionPath,
    emitSnapshot?: () => void,
    account?: HydrationEntryAccount
): Promise<void> {
    try {
        return await hydrateActionDetailFromEditor(
            ctx,
            entry,
            work,
            listLength,
            read,
            entryPath,
            emitSnapshot,
            account
        );
    } catch (error) {
        if (isTaskCancelled(error)) throw error;
        const inner = error instanceof Error ? error.message : String(error);
        const path =
            entryPath === undefined ? `index ${entry.index}` : ActionPath.key(entryPath);
        const typeName = entry.action?.type ?? "<null>";
        throw new Error(`(at ${path}, ${typeName}) ${inner}`);
    }
}

async function hydrateActionDetailFromEditor(
    ctx: TaskContext,
    entry: ObservedActionSlot,
    work: ActionHydrationWork,
    listLength: number,
    read: ListReadOptions | undefined,
    entryPath: ActionPath,
    emitSnapshot?: () => void,
    account?: HydrationEntryAccount
): Promise<void> {
    if (entry.action === null) {
        return;
    }

    const note = entry.action.note;
    await goToPaginatedListPage(
        ctx,
        getPaginatedListPageForIndex(entry.index),
        ACTION_LIST_CONFIG
    );
    const actionSlot = await getPaginatedListSlotAtIndex(
        ctx,
        entry.index,
        listLength,
        ACTION_LIST_CONFIG
    );
    entry.slot = actionSlot;
    entry.slotId = actionSlot.getSlotId();

    actionSlot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
    const spec = getActionIo(entry.action.type);

    if (spec.read) {
        const readCtx = createActionReadContext({
            ctx,
            actionPath: entryPath,
            actionType: entry.action.type,
            itemRegistry: read?.itemRegistry,
            itemCaptures: read?.itemCaptures,
            events: read?.events,
            emitSnapshot,
            readChildActions: readActionList,
            readConditions: readConditionList,
            ...(account === undefined
                ? {}
                : {
                      childListProgress: (prop: ChildListName) => ({
                          progress: (payload: ProgressPayload) =>
                              account.onChildPayload(prop, payload),
                          phaseUnits: {
                              setup: 0,
                              reading: 0,
                              hydrating: 0,
                              applying: 0,
                          },
                      }),
                  }),
        });
        entry.action = await spec.read({
            ctx,
            childListsToRead: work.childListsToRead,
            read: readCtx,
            current: entry.action,
        });
        if (note) {
            entry.action.note = note;
        }
    } else if (work.childListsToRead.size > 0) {
        throw new Error(`Reading action "${entry.action.type}" is not implemented.`);
    } else {
        refreshTruncatedScalarFields(ctx, entry.action, work.scalarFieldsToRead);
    }

    if (read?.itemCaptures !== undefined && entry.action !== null) {
        const itemFields = work.itemFieldsToCapture;
        for (let i = 0; i < itemFields.length; i++) {
            const field = itemFields[i];
            const displayName = (entry.action as Record<string, unknown>)[field.prop];
            if (typeof displayName === "string" && displayName.length > 0) {
                const captured = await captureItemFromOpenEditorField(
                    ctx,
                    field.label,
                    read.itemCaptures,
                    displayName
                );
                if (captured !== null) {
                    (entry.action as Record<string, unknown>)[field.prop] = captured;
                }
            }
        }
    }

    await clickGoBack(ctx);
    entry.hydrated =
        entry.action !== null && presentChildListsContainNoNulls(entry.action);
}
