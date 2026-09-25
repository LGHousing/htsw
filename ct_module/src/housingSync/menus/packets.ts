import TaskContext from "../../tasks/context";
import {
    C10PacketCreativeInventoryAction,
    S2FPacketSetSlot,
    setSlotPacketSlot,
    setSlotPacketStack,
    setSlotPacketWindowId,
} from "../../utils/packets";
import { getPlayer, sendPacket } from "../../utils/java";
import type { WaitForPromise } from "../../tasks/specifics/waitFor";

type Packet = MCPacket<MCINetHandler>;

export const HOTBAR_ZERO_PACKET_SLOT = 36;
export const SET_SLOT_ACK_TIMEOUT_MS = 2000;
// ~2s at 50ms/tick — tick budget for a creative inventory edit to show up in
// the live slot when we poll for it instead of waiting on the ack packet.
export const SET_SLOT_ACK_MAX_TICKS = 40;

export function waitForAnySetSlot(ctx: TaskContext): Promise<[Packet]> {
    return ctx.waitFor("packetReceived", (packet) => packet instanceof S2FPacketSetSlot);
}

/**
 * Waiter for the player-inventory S2FPacketSetSlot that acknowledges a
 * creative edit of `packetSlot`. Register it BEFORE sending the edit: the
 * house can overwrite the slot within the same tick the ack lands (a loop
 * that swaps the item, say), and a once-per-tick inventory poll then never
 * sees the accepted stack. Callers must `cleanupWaiter` it.
 */
export function waitForSetSlotAck(
    ctx: TaskContext,
    packetSlot: number,
    accepts: (stack: HtswMinecraftItemStack | null) => boolean
): WaitForPromise<[Packet]> {
    return ctx.waitFor(
        "packetReceived",
        (packet) =>
            packet instanceof S2FPacketSetSlot &&
            setSlotPacketWindowId(packet) === 0 &&
            setSlotPacketSlot(packet) === packetSlot &&
            accepts(setSlotPacketStack(packet))
    );
}

export function sendCreativeInventoryAction(
    ctx: TaskContext,
    packetSlot: number,
    stack: HtswMinecraftItemStack | null
): void {
    sendPacket(new C10PacketCreativeInventoryAction(packetSlot, stack));
}

export function selectHotbarSlot(ctx: TaskContext, hotbarSlot: number): void {
    // field_71071_by = InventoryPlayer, field_70461_c = selected hotbar index.
    // Vanilla sends C09PacketHeldItemChange once on the next tick when this changes.
    getPlayer().field_71071_by.field_70461_c = hotbarSlot;
}

export function selectedHotbarSlot(): number {
    // field_71071_by = InventoryPlayer, field_70461_c = selected hotbar index.
    return getPlayer().field_71071_by.field_70461_c;
}
