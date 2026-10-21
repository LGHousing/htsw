// Client module: declared here, implemented by the client (ct_module/src/housingSync/items/heldItem.ts on
// ChatTriggers). The client's bundler resolves every import of this file to its
// implementation, so nothing here runs. See platform.ts.
import type TaskContext from "../../tasks/context";
import type { InventorySlotSnapshot } from "./playerInventory";
import type { Item } from "../../platform";

export type ImportedItemPlacementSession = {
    place(ctx: TaskContext, item: Item): Promise<void>;
    restore(ctx: TaskContext): Promise<void>;
};

export type TemporarilyHeldItem = {
    slot: InventorySlotSnapshot;
    selectedHotbarSlot: number;
};

export type HeldInventoryItem = {
    selectedHotbarSlot: number;
    hotbarSlot: number;
    swap?: {
        mainSlot: number;
        hotbar: InventorySlotSnapshot;
        main: InventorySlotSnapshot;
    };
};

export declare function createImportedItemPlacementSession(): ImportedItemPlacementSession;
export declare function temporarilyHoldItem(
    ctx: TaskContext,
    item: Item
): Promise<TemporarilyHeldItem>;
export declare function restoreTemporarilyHeldItem(
    ctx: TaskContext,
    held: TemporarilyHeldItem
): Promise<void>;
export declare function holdInventoryItem(
    ctx: TaskContext,
    item: Item
): Promise<HeldInventoryItem>;
export declare function restoreHeldInventoryItem(
    ctx: TaskContext,
    held: HeldInventoryItem
): Promise<void>;
export declare function assertHeldStackIs(item: Item, label: string): void;
