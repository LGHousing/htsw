import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    selectedSlot: 0,
    sendCreativeInventoryAction: vi.fn(),
    selectHotbarSlot: vi.fn(),
}));

vi.mock("../src/housingSync/menus/packets", () => ({
    HOTBAR_ZERO_PACKET_SLOT: 36,
    SET_SLOT_ACK_MAX_TICKS: 40,
    selectedHotbarSlot: () => mocks.selectedSlot,
    selectHotbarSlot: (_ctx: unknown, slot: number) => {
        mocks.selectedSlot = slot;
        mocks.selectHotbarSlot(slot);
    },
    sendCreativeInventoryAction: (
        _ctx: unknown,
        packetSlot: number,
        stack: unknown
    ) => mocks.sendCreativeInventoryAction(packetSlot, stack),
}));

vi.mock("../src/housingSync/sideEffects", () => ({
    closeOpenScreen: vi.fn(async () => undefined),
}));

vi.mock("../src/housingSync/progress/timing", () => ({
    timed: vi.fn(async (_name: string, _cost: number, fn: () => Promise<unknown>) => fn()),
}));

import {
    injectHeldItem,
    restoreHeldItemPlacement,
} from "../src/importables/items/import";

function stack(name: string) {
    const itemType = {};
    return {
        name,
        func_77973_b: () => itemType,
        func_77960_j: () => 0,
        field_77994_a: 1,
        func_82833_r: () => name,
    };
}

function wrappedStack(value: ReturnType<typeof stack> | null) {
    return value === null ? null : { getItemStack: () => value };
}

describe("held item hotbar placement", () => {
    let slots: Array<ReturnType<typeof stack> | null>;
    const ctx = {
        displayMessage: vi.fn(),
        sleep: vi.fn(async () => undefined),
        waitFor: vi.fn(async () => undefined),
    };

    beforeEach(() => {
        slots = Array.from({ length: 9 }, (_, slot) => stack(`original-${slot}`));
        mocks.selectedSlot = 4;
        mocks.selectHotbarSlot.mockClear();
        mocks.sendCreativeInventoryAction.mockReset();
        mocks.sendCreativeInventoryAction.mockImplementation((packetSlot, value) => {
            slots[packetSlot - 36] = value;
        });
        ctx.displayMessage.mockClear();
        ctx.sleep.mockClear();
        ctx.waitFor.mockClear();
        vi.stubGlobal("Player", {
            getInventory: () => ({
                getStackInSlot: (slot: number) => wrappedStack(slots[slot]),
            }),
        });
    });

    test("uses an empty hotbar slot without touching slot 0", async () => {
        const originalZero = slots[0];
        slots[3] = null;
        const injected = stack("injected");

        const placement = await injectHeldItem(
            ctx as never,
            { getItemStack: () => injected, getName: () => "Injected" } as never
        );

        expect(placement).toEqual({ borrowed: null });
        expect(slots[0]).toBe(originalZero);
        expect(slots[3]).toBe(injected);
        expect(mocks.sendCreativeInventoryAction).toHaveBeenCalledWith(39, injected);
        expect(mocks.selectedSlot).toBe(3);
    });

    test("restores a borrowed slot and previous selection", async () => {
        const originalZero = slots[0];
        const injected = stack("injected");

        const placement = await injectHeldItem(
            ctx as never,
            { getItemStack: () => injected, getName: () => "Injected" } as never
        );

        expect(placement.borrowed).toEqual({
            selectedSlot: 4,
            stack: originalZero,
        });
        expect(slots[0]).toBe(injected);

        await restoreHeldItemPlacement(ctx as never, placement);

        expect(slots[0]).toBe(originalZero);
        expect(mocks.selectedSlot).toBe(4);
        expect(mocks.sendCreativeInventoryAction).toHaveBeenLastCalledWith(
            36,
            originalZero
        );
    });
});
