import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    // Client-side inventory as the task sees it; injection fills a slot only
    // when `lagInjectedSlots` is false (the ack usually lands before the poll).
    filled: new Set<number>(),
    lagInjectedSlots: false,
    injected: [] as Array<{ slotId: number; name: string }>,
    failOn: null as string | null,
}));

const closeOpenScreen = vi.fn(async () => undefined);
vi.mock("../src/housingSync/sideEffects", () => ({ closeOpenScreen }));

vi.mock("../src/housingSync/items/heldItem", () => ({
    injectIntoInventorySlot: vi.fn(
        async (_ctx: unknown, slotId: number, stack: { name: string }) => {
            if (mocks.failOn === stack.name) throw new Error(`rejected ${stack.name}`);
            mocks.injected.push({ slotId, name: stack.name });
            if (!mocks.lagInjectedSlots) mocks.filled.add(slotId);
        }
    ),
}));

vi.mock("../src/housingSync/items/playerInventory", () => ({
    readInventorySlot: (slotId: number) => ({
        slotId,
        nbt: mocks.filled.has(slotId) ? "{}" : null,
        count: mocks.filled.has(slotId) ? 1 : 0,
    }),
}));

vi.mock("../src/housingSync/taskRunner", () => ({
    runHousingSyncTask: vi.fn(),
}));

vi.mock("../src/tasks/manager", () => ({
    TaskManager: { isBusy: () => false },
}));

import { giveItems } from "../src/housingSync/items/giveItem";

function giveable(name: string) {
    return { label: name, item: { getItemStack: () => ({ name }) } as never };
}

const ctx = {} as never;

describe("giveItems", () => {
    beforeEach(() => {
        mocks.filled = new Set([0, 1, 2]);
        mocks.lagInjectedSlots = false;
        mocks.injected = [];
        mocks.failOn = null;
        closeOpenScreen.mockClear();
    });

    test("leaves the open screen alone", async () => {
        await giveItems(ctx, [giveable("a")]);

        expect(closeOpenScreen).not.toHaveBeenCalled();
    });

    test("fills the first empty slots in inventory order", async () => {
        const summary = await giveItems(ctx, [giveable("a"), giveable("b")]);

        expect(summary).toEqual({ given: 2, total: 2, stopped: null });
        expect(mocks.injected).toEqual([
            { slotId: 3, name: "a" },
            { slotId: 4, name: "b" },
        ]);
    });

    test("never reuses a slot whose client-side stack has not caught up yet", async () => {
        mocks.lagInjectedSlots = true;

        const summary = await giveItems(ctx, [giveable("a"), giveable("b")]);

        expect(summary.given).toBe(2);
        expect(mocks.injected.map((entry) => entry.slotId)).toEqual([3, 4]);
    });

    test("stops cleanly when the inventory is full", async () => {
        for (let slotId = 0; slotId < 36; slotId++) mocks.filled.add(slotId);
        mocks.filled.delete(20);

        const summary = await giveItems(ctx, [giveable("a"), giveable("b"), giveable("c")]);

        expect(summary).toEqual({ given: 1, total: 3, stopped: { kind: "full" } });
        expect(mocks.injected).toEqual([{ slotId: 20, name: "a" }]);
    });

    test("reports the item that Hypixel rejected and keeps the count so far", async () => {
        mocks.failOn = "b";

        const summary = await giveItems(ctx, [giveable("a"), giveable("b"), giveable("c")]);

        expect(summary.given).toBe(1);
        expect(summary.stopped).toEqual({
            kind: "error",
            label: "b",
            message: "rejected b",
        });
    });
});
