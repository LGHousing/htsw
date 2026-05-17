/**
 * Mutates a Housing condition list to match desired. Handles the invert
 * toggle (every condition editor exposes one — actions don't share that rule)
 * and includes `importCondition` since it shares the apply path's invert and
 * note logic.
 */
import { Diagnostic } from "htsw";
import type { Condition } from "htsw/types";

import TaskContext from "../../tasks/context";
import { type ItemRegistry } from "../../importables/itemRegistry";
import {
    clickGoBack,
    isLimitExceeded,
    readBooleanValue,
    setListItemNote,
    setNoteOnLastVisibleSlot,
    timedWaitForMenu,
} from "../gui/helpers";
import { ItemSlot, MouseButton } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import { CONDITION_MAPPINGS } from "../fields/conditionMappings";
import type {
    ConditionListDiff,
    ConditionListOperation,
    ObservedConditionSlot,
} from "../types";
import type { ActionListProgressSink } from "../progress/types";
import { getPaginatedListSlotAtIndex } from "../gui/paginatedList";
import { CONDITION_LIST_CONFIG } from "./listConfig";
import { getConditionSpec, writeOpenCondition } from "../conditions";
import {
    conditionListDiffApplyUnits,
    conditionOperationUnits,
    phaseUnitsFromParts,
    type ListPhaseUnits,
} from "../progress/costs";

type LiveConditionListEntry = {
    entryId: number;
    condition: Condition | null;
};

function getInvertSlot(ctx: TaskContext): ItemSlot {
    return ctx.getMenuItemSlot((slot) => {
        const name = removedFormatting(slot.getItem().getName()).trim().toLowerCase();
        return name === "invert" || name === "inverted";
    });
}

async function setOpenConditionInverted(
    ctx: TaskContext,
    desiredInverted: boolean,
    knownCurrentInverted?: boolean
): Promise<void> {
    const invertSlot = getInvertSlot(ctx);
    const currentInverted = knownCurrentInverted ?? readBooleanValue(invertSlot) ?? false;

    if (currentInverted === desiredInverted) {
        return;
    }

    invertSlot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
}

async function importCondition(
    ctx: TaskContext,
    condition: Condition,
    itemRegistry?: ItemRegistry
): Promise<void> {
    ctx.getMenuItemSlot("Add Condition").click();
    await timedWaitForMenu(ctx, "menuClickWait");

    const spec = getConditionSpec(condition.type);
    const slot = ctx.getMenuItemSlot(spec.displayName);

    if (isLimitExceeded(slot, "condition")) {
        throw Diagnostic.error(
            `Maximum amount of ${spec.displayName} conditions exceeded`
        );
    }

    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
    await writeOpenCondition(ctx, condition, undefined, itemRegistry);

    await setOpenConditionInverted(ctx, condition.inverted === true);
    // we ALWAYS click go back because every single condition has
    // the invert toggle so opens a submenu, this is not the case for actions
    await clickGoBack(ctx);

    await setNoteOnLastVisibleSlot(ctx, condition.note);
}

async function deleteObservedCondition(
    ctx: TaskContext,
    index: number,
    listLength: number
): Promise<void> {
    const slot = await getPaginatedListSlotAtIndex(ctx, index, listLength, CONDITION_LIST_CONFIG);
    slot.click(MouseButton.RIGHT);
    await timedWaitForMenu(ctx, "menuClickWait");
}

function findCurrentConditionIndex(
    entries: readonly LiveConditionListEntry[],
    entryId: number
): number {
    for (let i = 0; i < entries.length; i++) {
        if (entries[i].entryId === entryId) return i;
    }
    return -1;
}

function recomputeTotal(units: ListPhaseUnits): number {
    return units.readPart + units.hydratePart + units.applyPart;
}

export async function applyConditionListDiff(
    ctx: TaskContext,
    observed: ObservedConditionSlot[],
    diff: ConditionListDiff,
    itemRegistry?: ItemRegistry,
    progress?: ActionListProgressSink,
    phaseUnits?: ListPhaseUnits
): Promise<void> {
    const currentEntries: LiveConditionListEntry[] = [];
    for (let i = 0; i < observed.length; i++) {
        currentEntries.push({
            entryId: i,
            condition: observed[i].condition,
        });
    }
    let nextRuntimeEntryId = observed.length;
    const edits: Array<Extract<ConditionListOperation, { kind: "edit" }>> = [];
    const deletes: Array<Extract<ConditionListOperation, { kind: "delete" }>> = [];
    const adds: Array<Extract<ConditionListOperation, { kind: "add" }>> = [];
    for (const op of diff.operations) {
        if (op.kind === "edit") edits.push(op);
        else if (op.kind === "delete") deletes.push(op);
        else adds.push(op);
    }

    let completedOps = 0;
    let completedUnits = 0;
    const totalOps = diff.operations.length;
    const plannedApplyUnits = conditionListDiffApplyUnits(diff);
    if (phaseUnits !== undefined) {
        phaseUnits.applyPart = plannedApplyUnits;
        phaseUnits.total = recomputeTotal(phaseUnits);
    }
    const baseline = phaseUnits === undefined
        ? 0
        : phaseUnits.readPart + phaseUnits.hydratePart;
    const emitConditionOp = (label: string): void => {
        if (progress === undefined) return;
        if (totalOps === 0) return;
        progress({
            phase: "applying",
            phaseLabel: label,
            unitCompleted: completedOps,
            unitTotal: totalOps,
            completedUnits: baseline + completedUnits,
            totalUnits: phaseUnits === undefined
                ? plannedApplyUnits
                : phaseUnits.total,
            phaseUnits: phaseUnits === undefined
                ? {
                      reading: 0,
                      hydrating: 0,
                      applying: plannedApplyUnits,
                  }
                : phaseUnitsFromParts(phaseUnits),
        });
    };

    if (totalOps === 0) {
        progress?.({
            phase: "applying",
            phaseLabel: "condition diff up to date",
            unitCompleted: 1,
            unitTotal: 1,
            completedUnits: baseline + plannedApplyUnits,
            totalUnits: phaseUnits === undefined
                ? plannedApplyUnits
                : phaseUnits.total,
            phaseUnits: phaseUnits === undefined
                ? {
                      reading: 0,
                      hydrating: 0,
                      applying: plannedApplyUnits,
                  }
                : phaseUnitsFromParts(phaseUnits),
        });
        return;
    }

    for (const op of edits) {
        const currentIndex = findCurrentConditionIndex(currentEntries, op.entryId);
        if (currentIndex === -1) {
            continue;
        }

        const observedName = CONDITION_MAPPINGS[op.currentCondition.type].displayName;
        emitConditionOp(`edit condition ${observedName}`);

        const conditionSlot = await getPaginatedListSlotAtIndex(
            ctx,
            currentIndex,
            currentEntries.length,
            CONDITION_LIST_CONFIG
        );

        if (op.noteOnly) {
            await setListItemNote(ctx, conditionSlot, op.desired.note);
            completedUnits += conditionOperationUnits(op);
            completedOps++;
            currentEntries[currentIndex].condition = op.desired;
            continue;
        }

        conditionSlot.click();
        await timedWaitForMenu(ctx, "menuClickWait");

        await writeOpenCondition(
            ctx,
            op.desired,
            op.currentCondition,
            itemRegistry
        );

        const currentInverted = op.currentCondition.inverted === true;
        const desiredInverted = op.desired.inverted === true;
        await setOpenConditionInverted(ctx, desiredInverted, currentInverted);

        await clickGoBack(ctx);

        await setListItemNote(ctx, conditionSlot, op.desired.note);
        completedUnits += conditionOperationUnits(op);
        completedOps++;
        currentEntries[currentIndex].condition = op.desired;
    }

    deletes.sort((a, b) => {
        const bIndex = findCurrentConditionIndex(currentEntries, b.entryId);
        const aIndex = findCurrentConditionIndex(currentEntries, a.entryId);
        return bIndex - aIndex;
    });
    for (const op of deletes) {
        const index = findCurrentConditionIndex(currentEntries, op.entryId);
        if (index === -1) {
            continue;
        }

        const observedName =
            op.currentCondition === null
                ? "condition"
                : CONDITION_MAPPINGS[op.currentCondition.type].displayName;
        emitConditionOp(`delete condition ${observedName}`);

        await deleteObservedCondition(ctx, index, currentEntries.length);
        currentEntries.splice(index, 1);
        completedUnits += conditionOperationUnits(op);
        completedOps++;
    }

    for (const op of adds) {
        emitConditionOp(
            `add condition ${CONDITION_MAPPINGS[op.desired.type].displayName}`
        );
        await importCondition(ctx, op.desired, itemRegistry);
        currentEntries.push({
            entryId: nextRuntimeEntryId++,
            condition: op.desired,
        });
        completedUnits += conditionOperationUnits(op);
        completedOps++;
    }

    emitConditionOp("applied condition diff");
}

export function logConditionSyncState(ctx: TaskContext, diff: ConditionListDiff): void {
    if (diff.operations.length === 0) {
        ctx.displayMessage(`&7[cond-sync] &aUp to date.`);
        return;
    }

    ctx.displayMessage(`&7[cond-sync] &d${diff.operations.length} operation(s):`);
    let addIndex = 0;
    for (const op of diff.operations) {
        if (op.kind === "edit") {
            const observedName = CONDITION_MAPPINGS[op.currentCondition.type].displayName;
            ctx.displayMessage(
                `&7  &6~ ${observedName} &7-> &6${CONDITION_MAPPINGS[op.desired.type].displayName}`
            );
        } else if (op.kind === "delete") {
            const deleteName =
                op.currentCondition === null
                    ? "Unknown Condition"
                    : CONDITION_MAPPINGS[op.currentCondition.type].displayName;
            ctx.displayMessage(`&7  &c- ${deleteName}`);
        } else {
            ctx.displayMessage(
                `&7  &a+ [${addIndex}] ${CONDITION_MAPPINGS[op.desired.type].displayName}`
            );
            addIndex++;
        }
    }
}
