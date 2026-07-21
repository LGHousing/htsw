import { Diagnostic } from "htsw";
import type { Condition } from "htsw/types";

import TaskContext from "../../../../tasks/context";
import type { ResolveItemField } from "../../../items/itemReferences";
import {
    clickGoBack,
    isLimitExceeded,
    readBooleanValue,
    setNoteOnLastVisibleSlot,
} from "../../../menus/menuUtils";
import { timedWaitForMenu } from "../../../menus/menuWait";
import { ItemSlot, MouseButton } from "../../../../tasks/specifics/slots";
import { removedFormatting } from "../../../../utils/helpers";
import { getPaginatedListSlotAtIndex } from "../../../menus/paginatedList";
import { CONDITION_LIST_CONFIG } from "../../listConfigs";
import { getConditionIo, writeOpenCondition } from "../io";

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

export async function addConditionToOpenConditionList(
    ctx: TaskContext,
    condition: Condition,
    resolveItem: ResolveItemField
): Promise<void> {
    ctx.getMenuItemSlot("Add Condition").click();
    await timedWaitForMenu(ctx, "menuClickWait");

    const spec = getConditionIo(condition.type);
    const slot = ctx.getMenuItemSlot(spec.displayName);

    if (isLimitExceeded(slot, "condition")) {
        throw Diagnostic.error(
            `Maximum amount of ${spec.displayName} conditions exceeded`
        );
    }

    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
    await writeOpenCondition(ctx, condition, undefined, resolveItem);

    await setOpenConditionInverted(ctx, condition.inverted === true);
    await clickGoBack(ctx);

    await setNoteOnLastVisibleSlot(ctx, condition.note);
}

export async function appendConditionsToOpenConditionList(
    ctx: TaskContext,
    desired: Condition[],
    resolveItem: ResolveItemField
): Promise<void> {
    for (let i = 0; i < desired.length; i++) {
        await addConditionToOpenConditionList(ctx, desired[i], resolveItem);
    }
}

export async function deleteObservedCondition(
    ctx: TaskContext,
    index: number,
    listLength: number
): Promise<void> {
    const slot = await getPaginatedListSlotAtIndex(
        ctx,
        index,
        listLength,
        CONDITION_LIST_CONFIG
    );
    slot.click(MouseButton.RIGHT);
    await timedWaitForMenu(ctx, "menuClickWait");
}
