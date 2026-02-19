import { removedFormatting } from "../../helpers";

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

    public click(button: MouseButton = MouseButton.LEFT, shift: boolean = false): void {
        const container = Player.getContainer();
        if (container == null) {
            throw new Error("No open container found");
        }
        container.click(this.slotId, shift, button.valueOf());
    }
}

export function getItemSlots(): ItemSlot[] | null {
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

export function findItemSlot(
    check: ((slot: ItemSlot) => boolean) | string
): ItemSlot | null {
    if (typeof check === "string") {
        const name = removedFormatting(check);
        check = (slot: ItemSlot) => {
            return removedFormatting(slot.getItem().getName()) === name;
        };
    }

    const slots = getItemSlots();
    if (slots == null) return null;
    for (const slot of slots) {
        if (check(slot)) {
            return slot;
        }
    }
    return null;
}
