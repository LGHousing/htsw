import TaskContext from "../tasks/context";
import { getAllItemSlots, ItemSlot } from "../tasks/specifics/slots";
import {
    C09PacketHeldItemChange,
    C10PacketCreativeInventoryAction,
} from "../utils/packets";
import { clickGoBack, waitForMenu } from "./helpers";

const NBTTagCompound = Java.type("net.minecraft.nbt.NBTTagCompound");
const HOTBAR_PACKET_SLOT = 36;
const HOTBAR_INDEX = 0;

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

    Client.sendPacket(
        new C10PacketCreativeInventoryAction(HOTBAR_PACKET_SLOT, item.getItemStack())
    );
    if (Player.getPlayer().field_71071_by.field_70461_c !== HOTBAR_INDEX) {
        Client.sendPacket(new C09PacketHeldItemChange(HOTBAR_INDEX));
        Player.getPlayer().field_71071_by.field_70461_c = HOTBAR_INDEX;
    }

    await ctx.waitFor("tick");

    const slot = findVisibleInventoryItemSlot(item);
    if (slot === null) {
        throw new Error(`Could not find injected item for "${fieldName}" selection.`);
    }

    slot.click();
    await waitForMenu(ctx);
}

function findVisibleInventoryItemSlot(item: Item): ItemSlot | null {
    const desiredRawNbt = getRawItemNbt(item);
    const container = Player.getContainer();
    if (container == null) {
        return null;
    }

    const inventoryStart = Math.max(0, container.getSize() - 36);
    const slots = getAllItemSlots((slot) => slot.getSlotId() >= inventoryStart);
    if (slots === null) {
        return null;
    }

    if (desiredRawNbt !== null) {
        for (const slot of slots) {
            if (getRawItemNbt(slot.getItem()) === desiredRawNbt) {
                return slot;
            }
        }
    }

    return slots.find((slot) => slot.getSlotId() === HOTBAR_PACKET_SLOT) ?? null;
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
