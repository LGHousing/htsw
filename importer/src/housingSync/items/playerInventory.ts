// Client module: declared here, implemented by the client (ct_module/src/housingSync/items/playerInventory.ts on
// ChatTriggers). The client's bundler resolves every import of this file to its
// implementation, so nothing here runs. See platform.ts.
import type TaskContext from "../../tasks/context";
import type { Item } from "../../platform";

export type InventorySlotSnapshot = {
    slotId: number;
    nbt: string | null;
    count: number;
};

export type PlayerInventorySnapshot = {
    slots: InventorySlotSnapshot[];
    selectedHotbarSlot: number;
};

export declare function snapshotPlayerInventory(): PlayerInventorySnapshot;
export declare function heldItem(): Item | null;
export declare function restorePlayerInventory(
    ctx: TaskContext,
    snapshot: PlayerInventorySnapshot
): Promise<void>;
