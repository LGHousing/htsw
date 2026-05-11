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
} from "../helpers";
import { ItemSlot, MouseButton } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import { CONDITION_MAPPINGS } from "../conditionMappings";
import type { ObservedConditionSlot } from "../types";
import {
    type ConditionListDiff,
    onlyNoteDiffers,
} from "./diff";
import { getPaginatedListSlotAtIndex } from "../paginatedList";
import { CONDITION_LIST_CONFIG } from "./listConfig";
import { getConditionSpec, writeOpenCondition } from "../conditions";

function getInvertSlot(ctx: TaskContext): ItemSlot {
    return ctx.getMenuItemSlot((slot) => {
        const name = removedFormatting(slot.getItem().getName()).trim().toLowerCase();
        return name === "invert" || name === "inverted";
    });
}

export async function setOpenConditionInverted(
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

export async function importCondition(
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
    itemRegistry?: ItemRegistry
): Promise<void> {
    const currentObserved = [...observed];

    for (const entry of diff.edits) {
        const currentIndex = currentObserved.indexOf(entry.observed);
        if (currentIndex === -1) {
            continue;
        }

        const conditionSlot = await getPaginatedListSlotAtIndex(
            ctx,
            currentIndex,
            currentObserved.length,
            CONDITION_LIST_CONFIG
        );
        entry.observed.slot = conditionSlot;
        entry.observed.slotId = conditionSlot.getSlotId();

        if (onlyNoteDiffers(entry.desired, entry.observed?.condition)) {
            await setListItemNote(ctx, conditionSlot, entry.desired.note);
            continue;
        }

        conditionSlot.click();
        await timedWaitForMenu(ctx, "menuClickWait");

        if (!entry.observed.condition) {
            throw new Error(
                "Observed condition should always be present for edit operations."
            );
        }

        await writeOpenCondition(
            ctx,
            entry.desired,
            entry.observed.condition,
            itemRegistry
        );

        const currentInverted = entry.observed.condition.inverted === true;
        const desiredInverted = entry.desired.inverted === true;
        await setOpenConditionInverted(ctx, desiredInverted, currentInverted);

        await clickGoBack(ctx);

        await setListItemNote(ctx, conditionSlot, entry.desired.note);
    }

    const deletesDescending = [...diff.deletes].sort((a, b) => b.index - a.index);
    for (const observed of deletesDescending) {
        const index = currentObserved.indexOf(observed);
        if (index === -1) {
            continue;
        }

        await deleteObservedCondition(ctx, index, currentObserved.length);
        currentObserved.splice(index, 1);
    }

    for (const condition of diff.adds) {
        await importCondition(ctx, condition, itemRegistry);
    }
}

export function logConditionSyncState(ctx: TaskContext, diff: ConditionListDiff): void {
    const totalOps = diff.edits.length + diff.deletes.length + diff.adds.length;

    if (totalOps === 0) {
        ctx.displayMessage(`&7[cond-sync] &aUp to date.`);
        return;
    }

    ctx.displayMessage(`&7[cond-sync] &d${totalOps} operation(s):`);
    for (const entry of diff.edits) {
        const observedName =
            entry.observed.condition === null
                ? "Unknown Condition"
                : CONDITION_MAPPINGS[entry.observed.condition.type].displayName;
        ctx.displayMessage(
            `&7  &6~ [${entry.observed.index}] ${observedName} &7-> &6${CONDITION_MAPPINGS[entry.desired.type].displayName}`
        );
    }
    for (const entry of diff.deletes) {
        const deleteName =
            entry.condition === null
                ? "Unknown Condition"
                : CONDITION_MAPPINGS[entry.condition.type].displayName;
        ctx.displayMessage(`&7  &c- [${entry.index}] ${deleteName}`);
    }
    for (const [index, entry] of diff.adds.entries()) {
        ctx.displayMessage(
            `&7  &a+ [${index}] ${CONDITION_MAPPINGS[entry.type].displayName}`
        );
    }
}
