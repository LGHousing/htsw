import TaskContext from "../../tasks/context";
import { removedFormatting } from "../../utils/helpers";
import { timedWaitForMenu, waitForMenu } from "../gui/menuWait";
import { SET_SLOT_ACK_MAX_TICKS, sendCreativeInventoryAction } from "../gui/packets";
import { COST } from "../progress/costs";
import { timed } from "../progress/timing";

const INV_PACKET_SLOT = 26; // inventory row 2, column 9 (for HasItem and similar, rightmost, out of the way — matches BHTSL)

/**
 * Compares two NMS ItemStacks for the purpose of finding/placing the item a
 * field should hold. Defaults to exact `stacksEqual` (GIVE_ITEM, menu slots,
 * conditions need the precise item incl. NBT); the icon path passes a looser
 * item+count comparator.
 */
export type StackMatcher = (a: any, b: any) => boolean;

function slotMatchesStack(slotId: number, stack: any, match: StackMatcher): boolean {
    const slot = Player.getContainer()?.getItems()?.[slotId];
    return (
        slot !== null &&
        slot !== undefined &&
        match(slot.getItemStack(), stack)
    );
}

export function stacksEqual(left: any, right: any): boolean {
    // func_179549_c = ItemStack.areItemStacksEqual, including item, damage, size, and NBT.
    return left.func_179549_c(right);
}

// Must stay a finite for-loop, not a `while (!match) await SetSlot` wrapped in a
// timeout: on timeout that leaks a SetSlot waiter that re-registers itself on
// every future SetSlot. Polling the slot directly also means a missing server
// ack can't hang us.
async function waitForContainerSlotMatch(
    ctx: TaskContext,
    slotId: number,
    stack: any,
    match: StackMatcher
): Promise<boolean> {
    for (let i = 0; i < SET_SLOT_ACK_MAX_TICKS; i++) {
        if (slotMatchesStack(slotId, stack, match)) return true;
        await ctx.waitFor("tick");
    }
    return slotMatchesStack(slotId, stack, match);
}

/**
 * Set the value of a Housing "Item" field (GIVE_ITEM, REMOVE_ITEM, IS_ITEM, ...).
 *
 * Strategy:
 * 1. Click the field to open the item-selection submenu (shows player inventory)
 * 2. Scan the player inventory area for a matching item (via ItemStack equality)
 * 3. If found, click it directly — no injection needed
 * 4. If not found, inject into slot 26 via creative packet, wait for ack, click
 *
 * Uses slot 26 (row 2, col 9) to avoid clobbering hotbar items (matches BHTSL).
 */
export async function setItemValue(
    ctx: TaskContext,
    fieldName: string,
    item: Item,
    match: StackMatcher = stacksEqual
): Promise<void> {
    ctx.getItemSlot(fieldName).click();
    await timedWaitForMenu(ctx, "menuClickWait");

    await selectItemFromOpenInventory(ctx, item, fieldName, match);
}

/**
 * Select `item` from the player-inventory area of the currently open
 * item-selection menu. If the item is not already visible in inventory,
 * inject it into a scratch inventory slot first, then click it.
 */
export async function selectItemFromOpenInventory(
    ctx: TaskContext,
    item: Item,
    label: string,
    match: StackMatcher = stacksEqual
): Promise<void> {
    const container = Player.getContainer();
    if (container == null) {
        throw new Error(
            `No open container for "${label}" item selection — cannot inject item.`
        );
    }

    const playerInvStart = container.getSize() - 36;
    const desiredStack = item.getItemStack();

    const existingSlot = ctx.tryGetItemSlot((s) => {
        if (s.getSlotId() < playerInvStart) return false;
        const slotStack = s.getItem().getItemStack();
        return match(slotStack, desiredStack);
    });

    if (existingSlot !== null) {
        existingSlot.click();
        await timed("itemSelect", COST.itemSelect, () => waitForMenu(ctx));
        return;
    }

    const targetSlotInContainer = container.getSize() - 36 + (INV_PACKET_SLOT - 9);
    const scratchSlot = ctx.tryGetItemSlot((s) => s.getSlotId() === targetSlotInContainer);
    if (
        scratchSlot !== null &&
        match(scratchSlot.getItem().getItemStack(), desiredStack)
    ) {
        scratchSlot.click();
        await timed("itemSelect", COST.itemSelect, () => waitForMenu(ctx));
        return;
    }

    sendCreativeInventoryAction(
        ctx,
        INV_PACKET_SLOT,
        desiredStack,
    );
    const landed = await waitForContainerSlotMatch(
        ctx,
        targetSlotInContainer,
        desiredStack,
        match
    );
    if (!landed) {
        const itemName = removedFormatting(item.getName());
        throw new Error(
            `Couldn't place "${itemName}" for "${label}" — it never appeared in your ` +
            `inventory after a creative spawn. Hypixel blocks creative-spawning some ` +
            `items (command blocks, mob spawners, etc.); if "${itemName}" is one, this ` +
            `icon/item can't be imported automatically — use a normal item or set it by hand.`
        );
    }
    await ctx.waitFor("tick");

    const slot = ctx.tryGetItemSlot((s) => s.getSlotId() === targetSlotInContainer);
    if (slot === null) {
        throw new Error(
            `Could not find injected item for "${label}" selection at container slot ${targetSlotInContainer}.`
        );
    }

    slot.click();
    await timed("itemSelect", COST.itemSelect, () => waitForMenu(ctx));
}
