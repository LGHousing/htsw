import { beforeEach, describe, expect, test, vi } from "vitest";

import type { InventorySlotSnapshot } from "../src/housingSync/items/playerInventory";

const inventory = vi.hoisted(() => ({
    slots: [] as InventorySlotSnapshot[],
    clearedSlots: [] as number[],
    restoredSlots: [] as number[],
}));

vi.mock("../src/tasks/context", () => ({ default: vi.fn() }));
vi.mock("../src/housingSync/menus/menuUtils", () => ({
    clickGoBack: vi.fn(async () => undefined),
}));
vi.mock("../src/housingSync/menus/menuWait", () => ({
    timedWaitForMenu: vi.fn(async () => undefined),
}));
vi.mock("../src/utils/nbt", () => ({
    getItemFromSnbt: (snbt: string) => ({ snbt }),
}));
vi.mock("../src/housingSync/items/itemNbt", () => ({
    canonicalItemShellKey: (item: { snbt: string }) => `shell:${item.snbt}`,
    canonicalLiveItemKey: (item: { snbt: string }) =>
        item.snbt.replace(',tag:{captureEcho:"changed"}', ""),
    snbtFromItem: (item: { snbt: string }) => item.snbt,
}));
vi.mock("../src/housingSync/items/playerInventory", () => ({
    clearInventorySlot: async (_ctx: unknown, slotId: number, _view: "openContainer") => {
        inventory.clearedSlots.push(slotId);
        inventory.slots[slotId] = { slotId, nbt: null, count: 0 };
    },
    inventoryIsFull: () => inventory.slots.every((entry) => entry.nbt !== null),
    restoreInventorySlots: async (
        _ctx: unknown,
        snapshot: readonly InventorySlotSnapshot[],
        _view: "openContainer"
    ) => {
        for (let index = 0; index < snapshot.length; index++) {
            const expected = snapshot[index];
            const current = inventory.slots[index];
            if (current.nbt === expected.nbt && current.count === expected.count)
                continue;
            inventory.restoredSlots.push(expected.slotId);
            inventory.slots[index] = { ...expected };
        }
    },
    snapshotInventoryView: () => inventory.slots.map((entry) => ({ ...entry })),
    snapshotOpenContainerInventory: () => inventory.slots.map((entry) => ({ ...entry })),
}));

import {
    captureItemFromOpenEditorField,
    observeItemFromOpenEditorField,
} from "../src/housingSync/items/capture";

const EMPTY_INVENTORY = Array.from({ length: 36 }, (_, slotId) => ({
    slotId,
    nbt: null,
    count: 0,
}));

function item(snbt: string, count: number) {
    return {
        snbt,
        getStackSize: () => count,
        getItemStack: () => ({ field_77994_a: count }),
    };
}

function context(currentSnbt: string, actionItemCount: number, give: () => void) {
    const currentItem = item(currentSnbt, actionItemCount);
    return {
        tryGetItemSlot: () => ({ click: vi.fn() }),
        tryGetMenuItemSlot: () => ({
            getItem: () => currentItem,
            click: give,
        }),
        displayMessage: vi.fn(),
        waitFor: vi.fn(async () => undefined),
    };
}

beforeEach(() => {
    inventory.slots = EMPTY_INVENTORY.map((entry) => ({ ...entry }));
    inventory.clearedSlots = [];
    inventory.restoredSlots = [];
});

describe("editor item capture inventory handling", () => {
    test("leaves same-id and Damage custom skull stacks untouched", async () => {
        const firstSkull =
            '{id:"minecraft:skull",Count:1b,Damage:3s,tag:{SkullOwner:{Id:"first"}}}';
        const secondSkull =
            '{id:"minecraft:skull",Count:1b,Damage:3s,tag:{SkullOwner:{Id:"second"}}}';
        const capturedSkull =
            '{id:"minecraft:skull",Count:1b,Damage:3s,tag:{SkullOwner:{Id:"captured"}}}';
        inventory.slots[1] = { slotId: 1, nbt: firstSkull, count: 1 };
        inventory.slots[2] = { slotId: 2, nbt: secondSkull, count: 1 };
        const ctx = context(capturedSkull, 1, () => {
            inventory.slots[3] = { slotId: 3, nbt: capturedSkull, count: 1 };
        });

        const register = vi.fn(() => "captured");
        await expect(
            captureItemFromOpenEditorField(ctx as never, "Item", { register }, "item")
        ).resolves.toBe("captured");

        expect(inventory.clearedSlots).toEqual([]);
        expect(inventory.restoredSlots).toEqual([3]);
    });

    test("detects capture when the item merges into an existing stack", async () => {
        const one = '{id:"minecraft:stone",Count:1b,Damage:0s}';
        inventory.slots[4] = {
            slotId: 4,
            nbt: '{id:"minecraft:stone",Count:2b,Damage:0s}',
            count: 2,
        };
        const ctx = context(one, 1, () => {
            inventory.slots[4] = {
                slotId: 4,
                nbt: '{id:"minecraft:stone",Count:3b,Damage:0s}',
                count: 3,
            };
        });

        const register = vi.fn((_snbt: string, _displayNameHint: string) => "merged");
        await expect(
            captureItemFromOpenEditorField(ctx as never, "Item", { register }, "item")
        ).resolves.toBe("merged");

        expect(inventory.clearedSlots).toEqual([]);
        expect(register).toHaveBeenCalledOnce();
        expect(register.mock.calls[0][0]).toContain("Count:1b");
    });

    test("rejects an unrelated sole inventory change", async () => {
        const target = '{id:"minecraft:stone",Count:1b,Damage:0s}';
        inventory.slots[4] = {
            slotId: 4,
            nbt: '{id:"minecraft:stone",Count:2b,Damage:0s}',
            count: 2,
        };
        const ctx = context(target, 1, () => {
            inventory.slots[5] = {
                slotId: 5,
                nbt: '{id:"minecraft:dirt",Count:2b,Damage:0s}',
                count: 2,
            };
        });

        const register = vi.fn(() => "wrong");
        await expect(
            captureItemFromOpenEditorField(ctx as never, "Item", { register }, "item")
        ).resolves.toBeNull();

        expect(register).not.toHaveBeenCalled();
    });

    test("borrows the scratch slot when the inventory is full", async () => {
        inventory.slots = Array.from({ length: 36 }, (_, slotId) => ({
            slotId,
            nbt: `{id:"minecraft:stone",Count:1b,Damage:${slotId}s}`,
            count: 1,
        }));
        const captured = '{id:"minecraft:diamond",Count:1b,Damage:0s}';
        const ctx = context(captured, 1, () => {
            inventory.slots[0] = { slotId: 0, nbt: captured, count: 1 };
        });

        await captureItemFromOpenEditorField(
            ctx as never,
            "Item",
            { register: () => "captured" },
            "item"
        );

        expect(inventory.clearedSlots).toEqual([0]);
        expect(inventory.restoredSlots).toEqual([0]);
    });

    test("keys observations from editor SNBT while retaining recaptured SNBT", async () => {
        const editorSnbt = '{id:"minecraft:stone",Count:1b,Damage:0s}';
        const recapturedSnbt =
            '{id:"minecraft:stone",Count:1b,Damage:0s,tag:{captureEcho:"changed"}}';
        const ctx = context(editorSnbt, 1, () => {
            inventory.slots[5] = {
                slotId: 5,
                nbt: recapturedSnbt,
                count: 1,
            };
        });

        const observation = await observeItemFromOpenEditorField(
            ctx as never,
            "Item",
            "item"
        );

        expect(observation?.snbt).toBe(recapturedSnbt);
        expect(observation?.canonicalKey).toBe(`shell:${editorSnbt}`);
    });
});
