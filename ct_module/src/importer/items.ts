import TaskContext from "../tasks/context";
import {
    C09PacketHeldItemChange,
    C10PacketCreativeInventoryAction,
    S2FPacketSetSlot,
} from "../utils/packets";
import { clickGoBack, waitForMenu } from "./helpers";

const NBTTagCompound = Java.type("net.minecraft.nbt.NBTTagCompound");

const HOTBAR_PACKET_SLOT = 36;
const HOTBAR_INDEX = 0;
const SET_SLOT_ACK_TIMEOUT_MS = 2000;

/**
 * Set the value of a Housing "Item" field (GIVE_ITEM, REMOVE_ITEM, IS_ITEM, ...).
 *
 * The Hypixel UX is: clicking the field opens a sub-menu that contains the
 * player's inventory at the bottom; clicking an inventory slot picks that
 * slot's item as the field value. So the strategy is to inject the desired
 * item into hotbar slot 0 via creative-inventory packet, wait for the
 * server to ack the slot update, then click the matching slot inside the
 * open container.
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

    const currentItemSlot = ctx.tryGetItemSlot("Current Item");
    if (
        currentItemSlot !== null &&
        getRawItemNbt(currentItemSlot.getItem()) === getRawItemNbt(item)
    ) {
        await clickGoBack(ctx);
        return;
    }

    const container = Player.getContainer();
    if (container == null) {
        throw new Error(
            `No open container after clicking "${fieldName}" — cannot inject item.`
        );
    }
    const hotbarSlot0InContainer = container.getSize() - 9;

    Client.sendPacket(
        new C10PacketCreativeInventoryAction(HOTBAR_PACKET_SLOT, item.getItemStack())
    );
    if (Player.getPlayer().field_71071_by.field_70461_c !== HOTBAR_INDEX) {
        Client.sendPacket(new C09PacketHeldItemChange(HOTBAR_INDEX));
        Player.getPlayer().field_71071_by.field_70461_c = HOTBAR_INDEX;
    }

    // Wait for the server to ack the slot update before we try to click it.
    // The server can send the confirmation against either:
    //   - the open window's mirrored hotbar 0 slot, or
    //   - windowID 0 (player inventory) slot 36 directly,
    // depending on context. Accept either.
    // TODO: Figure out which one actually sends
    await ctx.withTimeout(
        ctx.waitFor("packetReceived", (packet) => {
            if (!(packet instanceof S2FPacketSetSlot)) return false;
            const windowId = packet.func_149175_c();
            const slotIdx = packet.func_149173_d();
            return (
                (windowId !== 0 && slotIdx === hotbarSlot0InContainer) ||
                (windowId === 0 && slotIdx === HOTBAR_PACKET_SLOT)
            );
        }),
        `creative-inventory ack for "${fieldName}"`,
        SET_SLOT_ACK_TIMEOUT_MS
    );
    // Mirror waitformenu
    await ctx.waitFor("tick");

    const slot = ctx.tryGetItemSlot(
        (s) => s.getSlotId() === hotbarSlot0InContainer
    );
    if (slot === null) {
        throw new Error(
            `Could not find injected item for "${fieldName}" selection at container slot ${hotbarSlot0InContainer}.`
        );
    }

    slot.click();
    await waitForMenu(ctx);
}

function getRawItemNbt(item: Item): string | null {
    try {
        const raw = (item as any).getRawNBT?.();
        if (raw !== undefined && raw !== null) {
            return String(raw);
        }
    } catch {
        // fall through to ItemStack serialization
    }

    try {
        const stack = item.getItemStack();
        if (stack === undefined || stack === null) {
            return null;
        }

        return String(stack.func_77955_b(new NBTTagCompound()));
    } catch {
        return null;
    }
}
