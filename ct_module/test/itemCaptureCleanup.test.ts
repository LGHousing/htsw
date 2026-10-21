import { beforeEach, expect, test, vi } from "vitest";

type FakeItem = { snbt: string; getStackSize(): number };
const state = vi.hoisted(() => ({
    creative: true,
    revokeAfterPacket: false,
    slots: [] as Array<FakeItem | null>,
    packets: [] as number[],
}));

vi.mock("../src/utils/java", async (original) => ({
    ...(await original<typeof import("../src/utils/java")>()),
    getPlayer: () => ({ field_71075_bZ: { field_75098_d: state.creative } }),
    sendPacket: (packet: { slot: number }) => {
        state.packets.push(packet.slot);
        state.slots[packet.slot >= 36 ? packet.slot - 36 : packet.slot] = null;
        if (state.revokeAfterPacket) state.creative = false;
    },
}));
vi.mock("../src/utils/packets", async (original) => ({
    ...(await original<typeof import("../src/utils/packets")>()),
    C10PacketCreativeInventoryAction: class {
        constructor(public slot: number) {}
    },
}));
vi.mock("@htsw/importer/housingSync/items/itemNbt", () => ({
    snbtFromItem: (item: FakeItem) => item.snbt,
    canonicalItemShellSnbtKey: (snbt: string) => snbt,
}));
vi.mock("@htsw/importer/housingSync/menus/menuUtils", () => ({
    clickGoBack: async () => undefined,
}));
vi.mock("@htsw/importer/housingSync/menus/menuWait", () => ({
    timedWaitForMenu: async () => undefined,
}));

import { captureItemFromOpenEditorField } from "../src/housingSync/items/capture";

beforeEach(() => {
    state.creative = true;
    state.revokeAfterPacket = false;
    state.slots = Array.from({ length: 36 }, () => null);
    state.packets = [];
    vi.stubGlobal("Player", {
        getInventory: () => ({ getStackInSlot: (slot: number) => state.slots[slot] }),
        getContainer: () => null,
    });
});

test.each(["before cleanup", "during cleanup"])(
    "nested capture stops creative packets when mode is revoked %s",
    async (when) => {
        const item: FakeItem = {
            snbt: '{id:"minecraft:stone",Count:1b,Damage:0s}',
            getStackSize: () => 1,
        };
        const ctx = {
            tryGetItemSlot: () => ({ click: () => undefined }),
            tryGetMenuItemSlot: () => ({
                getItem: () => item,
                click: () => {
                    state.slots[5] = item;
                    state.slots[6] = item;
                    if (when === "before cleanup") state.creative = false;
                    else state.revokeAfterPacket = true;
                },
            }),
            checkCancelled: () => undefined,
            displayMessage: vi.fn(),
            waitFor: async () => [],
            withTimeout: (promise: Promise<unknown>) => promise,
        };
        await expect(
            captureItemFromOpenEditorField(
                ctx as never,
                "Item",
                { register: () => "captured" },
                "item"
            )
        ).rejects.toThrow(/creative.*unrestored/i);
        expect(state.packets).toEqual(when === "before cleanup" ? [] : [41]);
        expect(state.slots[6]).toBe(item);
    }
);
