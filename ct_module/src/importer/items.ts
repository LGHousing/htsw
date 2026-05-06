import TaskContext from "../tasks/context";
import { timedWaitForMenu, waitForMenu } from "./helpers";
import {
    SET_SLOT_ACK_TIMEOUT_MS,
    sendCreativeInventoryAction,
    waitForAnySetSlot,
} from "./packets";
import { COST } from "./progress/costs";
import { timed } from "./progress/timing";

const INV_PACKET_SLOT = 26; // inventory row 2, column 9 (for HasItem and similar, rightmost, out of the way — matches BHTSL)

function slotMatchesStack(slotId: number, stack: any): boolean {
    const slot = Player.getContainer()?.getItems()?.[slotId];
    return (
        slot !== null &&
        slot !== undefined &&
        stacksEqual(slot.getItemStack(), stack)
    );
}

function stacksEqual(left: any, right: any): boolean {
    // func_179549_c = ItemStack.areItemStacksEqual, including item, damage, size, and NBT.
    return left.func_179549_c(right);
}

async function waitForContainerSlotMatch(
    ctx: TaskContext,
    slotId: number,
    stack: any
): Promise<void> {
    while (!slotMatchesStack(slotId, stack)) {
        await waitForAnySetSlot(ctx);
        await ctx.waitFor("tick");
    }
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
    item: Item
): Promise<void> {
    ctx.getItemSlot(fieldName).click();
    await timedWaitForMenu(ctx, "menuClickWait");

    await selectItemFromOpenInventory(ctx, item, fieldName);
}

/**
 * Select `item` from the player-inventory area of the currently open
 * item-selection menu. If the item is not already visible in inventory,
 * inject it into a scratch inventory slot first, then click it.
 */
export async function selectItemFromOpenInventory(
    ctx: TaskContext,
    item: Item,
    label: string
): Promise<void> {
    const container = Player.getContainer();
    if (container == null) {
        throw new Error(
            `No open container for "${label}" item selection — cannot inject item.`
        );
    }

    const playerInvStart = container.getSize() - 36;
    const desiredStack = item.getItemStack();

    // Scan player inventory slots in the container for a matching item
    const existingSlot = ctx.tryGetItemSlot((s) => {
        if (s.getSlotId() < playerInvStart) return false;
        const slotStack = s.getItem().getItemStack();
        return stacksEqual(slotStack, desiredStack);
    });

    if (existingSlot !== null) {
        existingSlot.click();
        await timed("itemSelect", COST.itemSelect, () => waitForMenu(ctx));
        return;
    }

    // Item not in inventory — inject via creative packet
    const targetSlotInContainer = container.getSize() - 36 + (INV_PACKET_SLOT - 9);
    const scratchSlot = ctx.tryGetItemSlot((s) => s.getSlotId() === targetSlotInContainer);
    if (
        scratchSlot !== null &&
        stacksEqual(scratchSlot.getItem().getItemStack(), desiredStack)
    ) {
        scratchSlot.click();
        await timed("itemSelect", COST.itemSelect, () => waitForMenu(ctx));
        return;
    }

    const ack = waitForContainerSlotMatch(ctx, targetSlotInContainer, desiredStack);
    sendCreativeInventoryAction(
        ctx,
        INV_PACKET_SLOT,
        desiredStack,
        `injecting item-field value for &f${label}`
    );

    try {
        await ctx.withTimeout(
            ack,
            `creative-inventory ack for "${label}"`,
            SET_SLOT_ACK_TIMEOUT_MS
        );
    } catch (error) {
        const matchedSlot = ctx.tryGetItemSlot((s) => {
            if (s.getSlotId() !== targetSlotInContainer) return false;
            return stacksEqual(s.getItem().getItemStack(), desiredStack);
        });
        if (matchedSlot === null) {
            throw error;
        }
        ctx.displayMessage(
            `&e[packet] item-field ack was not observed for &f${label}&e, but the scratch slot matches; continuing.`
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
