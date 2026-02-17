const C10PacketCreativeInventoryAction = Java.type(
    "net.minecraft.network.play.client.C10PacketCreativeInventoryAction"
);

export function loadItemstack(itemStack: any, slot: number) {
    const existing = Player.getInventory()?.getStackInSlot(slot - 5);
    if (existing != null && existing.getItemStack().func_179549_c(itemStack)) return;
    Client.sendPacket(
        new C10PacketCreativeInventoryAction(
            slot,
            itemStack
        )
    );
}
