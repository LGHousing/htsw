import TaskContext from "../tasks/context";
import {
    C10PacketCreativeInventoryAction,
    S2FPacketSetSlot,
} from "../utils/packets";

type Packet = MCPacket<MCINetHandler>;

export const HOTBAR_ZERO_PACKET_SLOT = 36;
export const SET_SLOT_ACK_TIMEOUT_MS = 2000;

export function waitForAnySetSlot(ctx: TaskContext): Promise<[Packet]> {
    return ctx.waitFor("packetReceived", (packet) => packet instanceof S2FPacketSetSlot);
}

export function sendCreativeInventoryAction(
    ctx: TaskContext,
    packetSlot: number,
    stack: any,
    label: string
): void {
    ctx.displayMessage(
        `&c&l[PACKET WARNING] &fC10PacketCreativeInventoryAction(${packetSlot}) &7- ${label}`
    );
    Client.sendPacket(new C10PacketCreativeInventoryAction(packetSlot, stack));
}

export function selectHotbarSlot(ctx: TaskContext, hotbarSlot: number, label: string): void {
    ctx.displayMessage(
        `&e[slot] selecting hotbar slot ${hotbarSlot} &7- ${label}`
    );
    // field_71071_by = InventoryPlayer, field_70461_c = selected hotbar index.
    // Vanilla sends C09PacketHeldItemChange once on the next tick when this changes.
    Player.getPlayer().field_71071_by.field_70461_c = hotbarSlot;
}

export function selectedHotbarSlot(): number {
    // field_71071_by = InventoryPlayer, field_70461_c = selected hotbar index.
    return Player.getPlayer().field_71071_by.field_70461_c;
}
