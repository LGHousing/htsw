import TaskContext from "../tasks/context";
import {
    C10PacketCreativeInventoryAction,
    S2FPacketSetSlot,
} from "../utils/packets";
import { waitForMenu } from "./helpers";

const INV_PACKET_SLOT = 26; // inventory row 2, column 9 (rightmost, out of the way — matches BHTSL)
const SET_SLOT_ACK_TIMEOUT_MS = 2000;

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
    await waitForMenu(ctx);

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
        return slotStack.func_179549_c(desiredStack);
    });

    if (existingSlot !== null) {
        existingSlot.click();
        await waitForMenu(ctx);
        return;
    }

    // Item not in inventory — inject via creative packet
    const targetSlotInContainer = container.getSize() - 36 + (INV_PACKET_SLOT - 9);

    Client.sendPacket(
        new C10PacketCreativeInventoryAction(INV_PACKET_SLOT, desiredStack)
    );

    await ctx.withTimeout(
        ctx.waitFor("packetReceived", (packet) => {
            if (!(packet instanceof S2FPacketSetSlot)) return false;
            const windowId = packet.func_149175_c();
            const slotIdx = packet.func_149173_d();
            return (
                (windowId !== 0 && slotIdx === targetSlotInContainer) ||
                (windowId === 0 && slotIdx === INV_PACKET_SLOT)
            );
        }),
        `creative-inventory ack for "${label}"`,
        SET_SLOT_ACK_TIMEOUT_MS
    );
    await ctx.waitFor("tick");

    const slot = ctx.tryGetItemSlot(
        (s) => s.getSlotId() === targetSlotInContainer
    );
    if (slot === null) {
        throw new Error(
            `Could not find injected item for "${label}" selection at container slot ${targetSlotInContainer}.`
        );
    }

    slot.click();
    await waitForMenu(ctx);
}
