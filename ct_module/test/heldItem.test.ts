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
    // Server-side script for a creative edit: what the server acks (null =
    // never acks) and what the slot holds by the time the poll runs.
    onCreativeAction: null as
        | null
        | ((packetSlot: number, value: unknown) => { ack: unknown; slot: unknown }),
    ackWaiters: [] as Array<{
        packetSlot: number;
        accepts: (stack: unknown) => boolean;
        resolve: () => void;
    }>,
    cleanedWaiters: 0,
    sentCreative: [] as Array<{ packetSlot: number; value: unknown }>,
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
        mocks.sentCreative.push({ packetSlot, value });
        const script = mocks.onCreativeAction;
        if (script === null) {
            mocks.slots[packetSlot - 36] = value as ReturnType<typeof stack> | null;
            return;
        }
        const outcome = script(packetSlot, value);
        for (const waiter of mocks.ackWaiters) {
            if (waiter.packetSlot === packetSlot && waiter.accepts(outcome.ack)) {
                waiter.resolve();
            }
        }
        mocks.slots[packetSlot - 36] = outcome.slot as ReturnType<typeof stack> | null;
    },
    waitForSetSlotAck: (
        _ctx: unknown,
        packetSlot: number,
        accepts: (stack: unknown) => boolean
    ) => {
        let resolve: () => void = () => undefined;
        const promise = new Promise<void>((r) => {
            resolve = r;
        }) as Promise<void> & { cleanupWaiter?: () => void };
        mocks.ackWaiters.push({ packetSlot, accepts, resolve });
        promise.cleanupWaiter = () => {
            mocks.cleanedWaiters++;
        };
        return promise;
    },
}));

vi.mock("../src/housingSync/items/playerInventory", () => ({
    inventorySlotToPacketSlot: (slotId: number) => slotId + 36,
    heldItem: () => {
        const value = mocks.slots[mocks.selectedSlot];
        return value === null ? null : { getItemStack: () => value };
    },
    readInventorySlot: (slotId: number) => ({
        slotId,
        nbt: mocks.slots[slotId] === null ? null : `{name:${mocks.slots[slotId].name}}`,
        count: mocks.slots[slotId] === null ? 0 : 1,
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
    assertHeldStackIs,
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
        mocks.onCreativeAction = null;
        mocks.ackWaiters = [];
        mocks.cleanedWaiters = 0;
        mocks.sentCreative = [];
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

    test("overwrites a borrowed slot without clearing it first", async () => {
        // Clearing first would abort the import if the server refilled the slot
        // (Housing handing back its menu item) before the item went in.
        const placement = createImportedItemPlacementSession();
        await placement.place(
            ctx as never,
            { getItemStack: () => stack("first") } as never
        );

        expect(mocks.sentCreative).toHaveLength(1);
        expect(mocks.sentCreative[0].packetSlot).toBe(36);
        expect((mocks.sentCreative[0].value as MockStack).name).toBe("first");
    });

    test("temporary holding overwrites an occupied slot without clearing it first", async () => {
        await temporarilyHoldItem(
            ctx as never,
            { getItemStack: () => stack("captured") } as never
        );

        expect(mocks.sentCreative.every(({ value }) => value !== null)).toBe(true);
        expect(mocks.slots[0]?.name).toBe("captured");
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
    test("counts the server ack as acceptance when the house swaps the slot before the poll", async () => {
        mocks.slots[3] = null;
        const injected = stack("plain fish");
        const swappedIn = stack("healing fish");
        mocks.onCreativeAction = () => ({ ack: injected, slot: swappedIn });
        const placement = createImportedItemPlacementSession();

        await placement.place(ctx as never, { getItemStack: () => injected } as never);

        expect(mocks.slots[3]).toBe(swappedIn);
        expect(mocks.selectedSlot).toBe(3);
        expect(mocks.cleanedWaiters).toBe(1);
    });

    test("names the replacing item when no ack ever arrives", async () => {
        mocks.slots[3] = null;
        const injected = stack("plain fish");
        mocks.onCreativeAction = () => ({ ack: null, slot: stack("healing fish") });
        const placement = createImportedItemPlacementSession();

        await expect(
            placement.place(ctx as never, { getItemStack: () => injected } as never)
        ).rejects.toThrow(/slot 3 now holds .*healing fish.*replaced it/);
        expect(mocks.cleanedWaiters).toBe(1);
    });

    test("keeps the SNBT hint when the slot stays empty", async () => {
        mocks.slots[3] = null;
        mocks.onCreativeAction = () => ({ ack: null, slot: null });
        const placement = createImportedItemPlacementSession();

        await expect(
            placement.place(ctx as never, { getItemStack: () => stack("bad") } as never)
        ).rejects.toThrow(/did not accept this item.*SNBT/);
    });

    test("assertHeldStackIs rejects a swapped held item before /edit", () => {
        const placed = stack("plain fish");
        mocks.slots[mocks.selectedSlot] = placed;
        expect(() =>
            assertHeldStackIs({ getItemStack: () => placed } as never, "Plain Fish")
        ).not.toThrow();

        mocks.slots[mocks.selectedSlot] = stack("healing fish");
        expect(() =>
            assertHeldStackIs({ getItemStack: () => placed } as never, "Plain Fish")
        ).toThrow(/replaced 'Plain Fish'.*healing fish/);
    });

});
