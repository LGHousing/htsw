import { beforeEach, describe, expect, test, vi } from "vitest";
import type { InventorySlotSnapshot } from "../src/housingSync/items/playerInventory";

type MockStack = {
    name: string;
    func_77973_b(): object;
    func_77960_j(): number;
    field_77994_a: number;
    func_82833_r(): string;
};

const mocks = vi.hoisted(() => ({
    selectedSlot: 4,
    slots: [] as Array<MockStack | null>,
    restoreInventorySlots: vi.fn(),
}));

vi.mock("../src/tasks/poll", () => ({
    pollTicks: vi.fn(
        async (
            _ctx: unknown,
            _ticks: number,
            predicate: () => boolean | Promise<boolean>
        ) => predicate()
    ),
}));

vi.mock("../src/housingSync/sideEffects", () => ({
    closeOpenScreen: vi.fn(async () => undefined),
    ensurePlayerInventoryScreen: vi.fn(async () => undefined),
}));

vi.mock("../src/housingSync/progress/timing", () => ({
    timed: vi.fn(async (_name: string, _cost: number, callback: () => unknown) =>
        callback()
    ),
}));

vi.mock("../src/housingSync/menus/packets", () => ({
    SET_SLOT_ACK_MAX_TICKS: 40,
    selectedHotbarSlot: () => mocks.selectedSlot,
    sendCreativeInventoryAction: (_ctx: unknown, packetSlot: number, value: unknown) => {
        mocks.slots[packetSlot - 36] = value as ReturnType<typeof stack> | null;
    },
}));

vi.mock("../src/housingSync/items/playerInventory", () => ({
    inventorySlotToPacketSlot: (slotId: number) => slotId + 36,
    readInventorySlot: (slotId: number) => ({
        slotId,
        nbt: mocks.slots[slotId] === null ? null : `{name:${mocks.slots[slotId].name}}`,
        count: mocks.slots[slotId] === null ? 0 : 1,
    }),
    clearInventorySlot: vi.fn(async (_ctx, slotId: number) => {
        mocks.slots[slotId] = null;
    }),
    restoreInventorySlots: vi.fn(
        async (_ctx: unknown, entries: InventorySlotSnapshot[]) => {
            mocks.restoreInventorySlots(entries);
            for (const entry of entries) {
                mocks.slots[entry.slotId] = entry.nbt === null ? null : stack("restored");
            }
        }
    ),
    selectHotbarSlotAndWait: vi.fn(async (_ctx, slotId: number) => {
        mocks.selectedSlot = slotId;
    }),
}));

import {
    createImportedItemPlacementSession,
    restoreTemporarilyHeldItem,
    temporarilyHoldItem,
} from "../src/housingSync/items/heldItem";

function stack(name: string): MockStack {
    const itemType = {};
    return {
        name,
        func_77973_b: () => itemType,
        func_77960_j: () => 0,
        field_77994_a: 1,
        func_82833_r: () => name,
    };
}

const ctx = {
    displayMessage: vi.fn(),
    sleep: vi.fn(async () => undefined),
    waitFor: vi.fn(async () => undefined),
};

describe("held item placement", () => {
    beforeEach(() => {
        mocks.selectedSlot = 4;
        mocks.slots = Array.from({ length: 9 }, (_, slotId) =>
            stack(`original-${slotId}`)
        );
        mocks.restoreInventorySlots.mockClear();
        vi.stubGlobal("Player", {
            getInventory: () => ({
                getStackInSlot: (slotId: number) => {
                    const value = mocks.slots[slotId];
                    return value === null ? null : { getItemStack: () => value };
                },
            }),
        });
    });

    test("uses an empty hotbar slot without borrowing another item", async () => {
        mocks.slots[3] = null;
        const injected = stack("injected");
        const placement = createImportedItemPlacementSession();

        await placement.place(
            ctx as never,
            {
                getItemStack: () => injected,
            } as never
        );

        expect(mocks.slots[0]?.name).toBe("original-0");
        expect(mocks.slots[3]).toBe(injected);
        expect(mocks.selectedSlot).toBe(3);
        await placement.restore(ctx as never);
        expect(mocks.restoreInventorySlots).not.toHaveBeenCalled();
    });

    test("borrows and restores slot 0 once across a full-hotbar batch", async () => {
        const placement = createImportedItemPlacementSession();
        await placement.place(
            ctx as never,
            {
                getItemStack: () => stack("first"),
            } as never
        );

        await placement.place(
            ctx as never,
            {
                getItemStack: () => stack("second"),
            } as never
        );

        expect(mocks.slots[0]?.name).toBe("second");
        expect(mocks.selectedSlot).toBe(0);

        await placement.restore(ctx as never);
        await placement.restore(ctx as never);

        expect(mocks.restoreInventorySlots).toHaveBeenCalledOnce();
        expect(mocks.slots[0]?.name).toBe("restored");
        expect(mocks.selectedSlot).toBe(4);
    });

    test("temporary holding restores an initially empty slot", async () => {
        mocks.slots[2] = null;

        const held = await temporarilyHoldItem(
            ctx as never,
            {
                getItemStack: () => stack("captured"),
            } as never
        );

        expect((mocks.slots[2] as MockStack | null)?.name).toBe("captured");
        expect(mocks.selectedSlot).toBe(2);

        await restoreTemporarilyHeldItem(ctx as never, held);

        expect(mocks.slots[2]).toBeNull();
        expect(mocks.selectedSlot).toBe(4);
    });
});
