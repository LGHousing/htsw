// Client module: declared here, implemented by the client (ct_module/src/utils/packets.ts on
// ChatTriggers). The client's bundler resolves every import of this file to its
// implementation, so nothing here runs. See platform.ts.
import type { MCItemStack } from "../platform";

/** Packet classes, for `packet instanceof S2DPacketOpenWindow`. */
export declare const S2DPacketOpenWindow: abstract new (...args: never[]) => unknown;
export declare const S30PacketWindowItems: abstract new (...args: never[]) => unknown;
export declare const S2FPacketSetSlot: abstract new (...args: never[]) => unknown;

export declare function openWindowPacketId(packet: unknown): number | null;
export declare function openWindowPacketGuiId(packet: unknown): string | null;
export declare function windowItemsPacketId(packet: unknown): number | null;
export declare function windowItemsPacketStacks(
    packet: unknown
): ArrayLike<MCItemStack | null>;
export declare function setSlotPacketWindowId(packet: unknown): number | null;
export declare function setSlotPacketSlot(packet: unknown): number | null;
export declare function setSlotPacketStack(packet: unknown): MCItemStack | null;
