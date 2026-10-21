// Client module: declared here, implemented by the client (ct_module/src/tasks/specifics/slots.ts on
// ChatTriggers). The client's bundler resolves every import of this file to its
// implementation, so nothing here runs. See platform.ts.
import type { Item } from "../../platform";

export declare enum MouseButton {
    LEFT = "LEFT",
    RIGHT = "RIGHT",
    MIDDLE = "MIDDLE",
}

/** One non-empty slot of the open container. */
export interface ItemSlot {
    getSlotId(): number;
    getItem(): Item;
    click(button?: MouseButton, shift?: boolean): void;
    drop(ctrl?: boolean): void;
}

export type DisplayedGuiMenuState = {
    screen: string;
    itemCount: number;
    slotCount: number;
    menuSlotCount: number;
    windowId: number | null;
};

export declare function getAllItemSlots(
    check?: null | ((slot: ItemSlot) => boolean)
): ItemSlot[] | null;
export declare function tryGetItemSlot(
    check: string | ((slot: ItemSlot) => boolean)
): ItemSlot | null;
export declare function getItemSlot(
    check: string | ((slot: ItemSlot) => boolean)
): ItemSlot;
export declare function getMenuItemSlots(
    check?: null | ((slot: ItemSlot) => boolean)
): ItemSlot[] | null;
export declare function tryGetMenuItemSlot(
    check: string | ((slot: ItemSlot) => boolean)
): ItemSlot | null;
export declare function getMenuItemSlot(
    check: string | ((slot: ItemSlot) => boolean)
): ItemSlot;
export declare function menuStateDescription(): string;
export declare function getOpenContainerTitle(): string | null;
export declare function getOpenContainerWindowId(): number | null;
export declare function getDisplayedGuiMenuState(): DisplayedGuiMenuState | null;
export declare function describeGuiScreenMenu(): string;
