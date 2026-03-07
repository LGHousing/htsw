import { removedFormatting } from "../../utils/helpers";

export enum MouseButton {
    LEFT = "LEFT",
    RIGHT = "RIGHT",
    MIDDLE = "MIDDLE",
}

export class ItemSlot {
    private slotId: number;
    private item: Item;

    constructor(slotId: number, item: Item) {
        this.slotId = slotId;
        this.item = item;
    }

    public getSlotId(): number {
        return this.slotId;
    }

    public getItem(): Item {
        return this.item;
    }

    public click(
        button: MouseButton = MouseButton.LEFT,
        shift: boolean = false,
    ): void {
        const container = Player.getContainer();
        if (container == null) {
            throw new Error("No open container found");
        }
        container.click(this.slotId, shift, button.valueOf());
    }
}

export function getAllItemSlots(): ItemSlot[] | null {
    const container = Player.getContainer();
    if (container == null) {
        return null;
    }

    const slots: ItemSlot[] = [];
    for (let slotId = 0; slotId < container.getSize(); slotId++) {
        const item = container.getStackInSlot(slotId);
        if (item == null) {
            continue;
        }
        slots.push(new ItemSlot(slotId, item));
    }

    return slots;
}

export function tryGetItemSlot(
    check: string | ((slot: ItemSlot) => boolean),
): ItemSlot | null {
    if (typeof check === "string") {
        const name = removedFormatting(check);
        check = (slot: ItemSlot) => {
            return removedFormatting(slot.getItem().getName()) === name;
        };
    }

    const slots = getAllItemSlots();
    if (slots == null) return null;
    for (const slot of slots) {
        if (check(slot)) {
            return slot;
        }
    }
    return null;
}

export function getItemSlot(
    check: string | ((slot: ItemSlot) => boolean),
): ItemSlot {
    const slot = tryGetItemSlot(check);
    if (slot === null) {
        if (typeof check === "string") {
            throw new Error(`Could not find "${check}"`);
        } else {
            throw new Error("Could not find item slot");
        }
    }
    return slot;
}
