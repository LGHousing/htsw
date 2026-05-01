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
 * The Hypixel UX is: clicking the field opens a sub-menu that contains the
 * player's inventory at the bottom; clicking an inventory slot picks that
 * slot's item as the field value. So the strategy is to inject the desired
 * item into inventory slot 26 (row 2, col 9) via creative-inventory packet,
 * wait for the server to ack the slot update, then click the matching slot
 * inside the open container.
 *
 * Uses slot 26 (out of the way) to avoid clobbering hotbar items.
 *
 * Caller is responsible for handing in a spawnable Item — for items that
 * carry click-actions (Housing-tagged NBT) that means the post-/edit
 * cached SNBT, not the raw source NBT.
 */
export async function setItemValue(
    ctx: TaskContext,
    fieldName: string,
    item: Item
): Promise<void> {
    ctx.getItemSlot(fieldName).click();
    await waitForMenu(ctx);

    const container = Player.getContainer();
    if (container == null) {
        throw new Error(
            `No open container after clicking "${fieldName}" — cannot inject item.`
        );
    }
    // In a chest-style container, player main inventory (packet slots 9-35)
    // starts at containerSize - 36. Packet slot 26 maps to:
    // containerSize - 36 + (26 - 9) = containerSize - 19
    const targetSlotInContainer = container.getSize() - 36 + (INV_PACKET_SLOT - 9);

    Client.sendPacket(
        new C10PacketCreativeInventoryAction(INV_PACKET_SLOT, item.getItemStack())
    );

    // Wait a tick for the creative packet to be processed, then check if
    // the item is already at the target slot (e.g. player already had it).
    // Hypixel won't send an ack packet for duplicate items.
    await ctx.waitFor("tick");

    const alreadyThere = ctx.tryGetItemSlot(
        (s) => s.getSlotId() === targetSlotInContainer && s.getItem() != null && s.getItem().getName() != null
    );

    if (alreadyThere === null) {
        // Item wasn't instant — wait for server ack
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
            `creative-inventory ack for "${fieldName}"`,
            SET_SLOT_ACK_TIMEOUT_MS
        );
        await ctx.waitFor("tick");
    }

    const slot = ctx.tryGetItemSlot(
        (s) => s.getSlotId() === targetSlotInContainer
    );
    if (slot === null) {
        throw new Error(
            `Could not find injected item for "${fieldName}" selection at container slot ${targetSlotInContainer}.`
        );
    }

    slot.click();
    await waitForMenu(ctx);
}
