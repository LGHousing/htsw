import { javaType } from "./java";

type RhinoString = string | { toString(): string };

export const C01PacketChatMessage = javaType(
    "net.minecraft.network.play.client.C01PacketChatMessage"
);

export const C10PacketCreativeInventoryAction = javaType(
    "net.minecraft.network.play.client.C10PacketCreativeInventoryAction"
);

export const S30PacketWindowItems = javaType(
    "net.minecraft.network.play.server.S30PacketWindowItems"
);

export const S2DPacketOpenWindow = javaType(
    "net.minecraft.network.play.server.S2DPacketOpenWindow"
);

export const S2FPacketSetSlot = javaType(
    "net.minecraft.network.play.server.S2FPacketSetSlot"
);

export function packetClassName(packet: unknown): string {
    try {
        const name = String(
            (packet as { getClass(): { getName(): RhinoString } }).getClass().getName()
        );
        return name.substring(name.lastIndexOf(".") + 1);
    } catch (_e) {
        return String(packet);
    }
}

export function openWindowPacketId(packet: unknown): number | null {
    try {
        return (packet as { func_148901_c(): number }).func_148901_c();
    } catch (_e) {
        return null;
    }
}

export function openWindowPacketTitle(packet: unknown): string | null {
    try {
        const comp = (
            packet as {
                func_179840_c(): { func_150260_c(): RhinoString | null | undefined };
            }
        ).func_179840_c();
        const text = comp.func_150260_c();
        return text === null || text === undefined ? null : String(text);
    } catch (_e) {
        return null;
    }
}

export function openWindowPacketGuiId(packet: unknown): string | null {
    try {
        return String((packet as { func_148902_e(): RhinoString }).func_148902_e());
    } catch (_e) {
        return null;
    }
}

export function windowItemsPacketId(packet: unknown): number | null {
    try {
        return (packet as { func_148911_c(): number }).func_148911_c();
    } catch (_e) {
        return null;
    }
}

export function windowItemsPacketStacks(
    packet: unknown
): HtswJavaObjectArray<HtswMinecraftItemStack | null> {
    try {
        return (
            packet as {
                func_148910_d(): HtswJavaObjectArray<HtswMinecraftItemStack | null>;
            }
        ).func_148910_d();
    } catch (_e) {
        return [];
    }
}

export function setSlotPacketWindowId(packet: unknown): number | null {
    try {
        return (packet as { func_149175_c(): number }).func_149175_c();
    } catch (_e) {
        return null;
    }
}

export function setSlotPacketSlot(packet: unknown): number | null {
    try {
        return (packet as { func_149173_d(): number }).func_149173_d();
    } catch (_e) {
        return null;
    }
}

export function setSlotPacketStack(packet: unknown): HtswMinecraftItemStack | null {
    try {
        return (
            packet as { func_149174_e(): HtswMinecraftItemStack | null }
        ).func_149174_e();
    } catch (_e) {
        return null;
    }
}

export function creativeInventoryPacketSlot(packet: unknown): number | null {
    try {
        return (packet as { func_149627_c(): number }).func_149627_c();
    } catch (_e) {
        return null;
    }
}

export function creativeInventoryPacketStack(
    packet: unknown
): HtswMinecraftItemStack | null {
    try {
        return (
            packet as { func_149625_d(): HtswMinecraftItemStack | null }
        ).func_149625_d();
    } catch (_e) {
        return null;
    }
}
