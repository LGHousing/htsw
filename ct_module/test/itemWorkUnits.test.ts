import { beforeEach, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({ slots: Array<unknown>(45).fill(null), existing: false }));
vi.mock("@htsw/importer/tasks/poll", () => ({ pollTicks: async (_ctx: unknown, _ticks: number, predicate: () => boolean) => predicate() }));
vi.mock("../src/housingSync/menus/packets", () => ({
    SET_SLOT_ACK_MAX_TICKS: 40,
    SET_SLOT_ACK_TIMEOUT_MS: 2000,
    selectedHotbarSlot: () => 0,
    sendCreativeInventoryAction: (_ctx: unknown, slot: number, stack: unknown) => { state.slots[slot] = stack === null ? null : { getItemStack: () => stack, getStackSize: () => 1 }; },
    waitForAnySetSlot: async () => undefined,
}));
vi.mock("@htsw/importer/housingSync/menus/menuWait", () => ({ waitForMenu: async () => undefined }));
vi.mock("@htsw/importer/runtimeDebug/runtimeDebugBuffer", () => ({ recordRuntimeDebug: () => undefined }));
vi.mock("../src/runtimeDebug/itemStackSummary", () => ({ summarizeItemStack: () => null }));
vi.mock("@htsw/importer/housingSync/items/itemNbt", () => ({ snbtFromItem: () => "{id:stone}" }));

import { selectItemFromOpenInventory } from "../src/housingSync/items/itemPicker";
import { restoreInventorySlots } from "../src/housingSync/items/playerInventory";
import { getSessionTimingUnits, resetSessionTiming } from "@htsw/importer/housingSync/progress/timing";
import { COST } from "@htsw/importer/housingSync/progress/costs";

beforeEach(() => {
    resetSessionTiming();
    state.slots.fill(null);
    state.existing = false;
    vi.stubGlobal("Player", {
        getContainer: () => ({ getSize: () => 45, getItems: () => state.slots }),
        getInventory: () => ({ getStackInSlot: (slot: number) => state.slots[slot] }),
    });
});

test("an existing inventory copy charges no injection or restoration", async () => {
    state.existing = true;
    await selectItemFromOpenInventory(context(), item(), "test", () => true);
    expect(getSessionTimingUnits()).toEqual({ itemSelect: COST.itemSelect });
});

test("a missing copy charges one injection and one scratch-slot restore", async () => {
    await selectItemFromOpenInventory(context(), item(), "test", () => true);
    expect(getSessionTimingUnits()).toEqual({
        itemInject: COST.itemInject, itemSelect: COST.itemSelect, inventoryRestore: COST.inventoryRestore,
    });
    expect(state.slots[26]).toBe(null);
});

test("an unchanged restore sends and charges nothing", async () => {
    await restoreInventorySlots(context(), [{ slotId: 26, nbt: null, count: 0 }]);
    expect(getSessionTimingUnits()).toEqual({});
});

function item(): Item {
    return { getItemStack: () => ({}), getName: () => "test" } as Item;
}
function context() {
    return {
        tryGetItemSlot: () => state.existing || state.slots[26] !== null
            ? { getItemStack: () => ({}), getSlotId: () => 26, getItem: item, click: () => undefined }
            : null,
        waitFor: async () => undefined,
        withTimeout: (work: Promise<void>) => work,
    } as never;
}
