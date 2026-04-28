// define all packet java types
// TODO DEFINE ALL THE FRICKING PACKETS OR SOMETHING

// const C01PacketChatMessage = Java.type(
//     "net.minecraft.network.play.client.C01PacketChatMessage"
// );
// const C0EPacketClickWindow = Java.type(
//     "net.minecraft.network.play.client.C0EPacketClickWindow"
// );
// const C0DPacketCloseWindow = Java.type(
//     "net.minecraft.network.play.client.C0DPacketCloseWindow"
// );
// const C0FPacketConfirmTransaction = Java.type(
//     "net.minecraft.network.play.client.C0FPacketConfirmTransaction"
// );

export const C09PacketHeldItemChange = Java.type(
    "net.minecraft.network.play.client.C09PacketHeldItemChange"
);

export const C10PacketCreativeInventoryAction = Java.type(
    "net.minecraft.network.play.client.C10PacketCreativeInventoryAction"
);

export const S30PacketWindowItems = Java.type(
    "net.minecraft.network.play.server.S30PacketWindowItems"
);

export const S2DPacketOpenWindow = Java.type(
    "net.minecraft.network.play.server.S2DPacketOpenWindow"
);

export const S2FPacketSetSlot = Java.type(
    "net.minecraft.network.play.server.S2FPacketSetSlot"
);
