/// <reference types="../../CTAutocomplete" />

import { assertIsNormalized, normalized, removeFormatting } from './utils';

export enum ButtonType {
    LEFT = 'LEFT',
    RIGHT = 'RIGHT',
    MIDDLE = 'MIDDLE',
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

    public click(buttonType: ButtonType, shift: boolean = false): void {
        const container = Player.getContainer();
        if (container == null) {
            throw new Error('No open container found');
        }
        container.click(this.slotId, shift, buttonType.valueOf());
    }
}

export function getSlots(): ItemSlot[] {
    const container = Player.getContainer();
    if (container == null) {
        throw new Error('No open container found');
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

export function getSlotFromName(name: string, isNormalized: boolean): ItemSlot | null {
    if (isNormalized) {
        assertIsNormalized(name);
    }
    const slots = getSlots();
    for (const slot of slots) {
        let slotName = removeFormatting(slot.getItem().getName());
        if (isNormalized) {
            slotName = normalized(slotName);
        }
        if (slotName === name) {
            return slot;
        }
    }
    return null;
}
