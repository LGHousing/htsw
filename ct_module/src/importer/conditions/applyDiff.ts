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

export async function applyConditionListDiff(
    ctx: TaskContext,
    observed: ObservedConditionSlot[],
    diff: ConditionListDiff,
    itemRegistry?: ItemRegistry,
    progress?: ActionListProgressSink
): Promise<void> {
    const currentObserved = [...observed];
    const edits: Array<Extract<ConditionListOperation, { kind: "edit" }>> = [];
    const deletes: Array<Extract<ConditionListOperation, { kind: "delete" }>> = [];
    const adds: Array<Extract<ConditionListOperation, { kind: "add" }>> = [];
    for (const op of diff.operations) {
        if (op.kind === "edit") edits.push(op);
        else if (op.kind === "delete") deletes.push(op);
        else adds.push(op);
    }

    let completedOps = 0;
    const totalOps = diff.operations.length;
    const emitConditionOp = (label: string): void => {
        if (progress === undefined) return;
        if (totalOps === 0) return;
        progress({
            phase: "applying",
            phaseLabel: label,
            unitCompleted: completedOps,
            unitTotal: totalOps,
            estimatedCompleted: completedOps,
            estimatedTotal: totalOps,
            etaConfidence: "planned",
            phaseBudget: null,
        });
    };

    // Edits first: indices don't shift while editing in place. Then deletes
    // (descending) so prior indices stay valid. Adds last — they append.
    for (const op of edits) {
        const currentIndex = currentObserved.indexOf(op.observed);
        if (currentIndex === -1) {
            continue;
        }

        const observedName =
            op.observed.condition === null
                ? "condition"
                : CONDITION_MAPPINGS[op.observed.condition.type].displayName;
        emitConditionOp(`edit condition ${observedName}`);

        const conditionSlot = await getPaginatedListSlotAtIndex(
            ctx,
            currentIndex,
            currentObserved.length,
            CONDITION_LIST_CONFIG
        );
        op.observed.slot = conditionSlot;
        op.observed.slotId = conditionSlot.getSlotId();

        if (op.noteOnly) {
            await setListItemNote(ctx, conditionSlot, op.desired.note);
            completedOps++;
            continue;
        }

        conditionSlot.click();
        await timedWaitForMenu(ctx, "menuClickWait");

        if (!op.observed.condition) {
            throw new Error(
                "Observed condition should always be present for edit operations."
            );
        }

        await writeOpenCondition(
            ctx,
            op.desired,
            op.observed.condition,
            itemRegistry
        );

        const currentInverted = op.observed.condition.inverted === true;
        const desiredInverted = op.desired.inverted === true;
        await setOpenConditionInverted(ctx, desiredInverted, currentInverted);

        await clickGoBack(ctx);

        await setListItemNote(ctx, conditionSlot, op.desired.note);
        completedOps++;
    }

    deletes.sort((a, b) => b.observed.index - a.observed.index);
    for (const op of deletes) {
        const index = currentObserved.indexOf(op.observed);
        if (index === -1) {
            continue;
        }

        const observedName =
            op.observed.condition === null
                ? "condition"
                : CONDITION_MAPPINGS[op.observed.condition.type].displayName;
        emitConditionOp(`delete condition ${observedName}`);

        await deleteObservedCondition(ctx, index, currentObserved.length);
        currentObserved.splice(index, 1);
        completedOps++;
    }

    for (const op of adds) {
        emitConditionOp(
            `add condition ${CONDITION_MAPPINGS[op.desired.type].displayName}`
        );
        await importCondition(ctx, op.desired, itemRegistry);
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
            const observedName =
                op.observed.condition === null
                    ? "Unknown Condition"
                    : CONDITION_MAPPINGS[op.observed.condition.type].displayName;
            ctx.displayMessage(
                `&7  &6~ [${op.observed.index}] ${observedName} &7-> &6${CONDITION_MAPPINGS[op.desired.type].displayName}`
            );
        } else if (op.kind === "delete") {
            const deleteName =
                op.observed.condition === null
                    ? "Unknown Condition"
                    : CONDITION_MAPPINGS[op.observed.condition.type].displayName;
            ctx.displayMessage(`&7  &c- [${op.observed.index}] ${deleteName}`);
        } else {
            ctx.displayMessage(
                `&7  &a+ [${addIndex}] ${CONDITION_MAPPINGS[op.desired.type].displayName}`
            );
            addIndex++;
        }
    }
}
