import { describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    captureBlockReference: vi.fn(async () => "minecraft:stone"),
    captureItem: vi.fn(async () => "ordinary_item"),
    slot: {
        click: vi.fn(),
        getSlotId: () => 4,
    },
}));

vi.mock("../src/housingSync/items/capture", () => ({
    captureBlockReferenceFromOpenEditorField: mocks.captureBlockReference,
    captureItemFromOpenEditorField: mocks.captureItem,
    observeItemFromOpenEditorField: vi.fn(),
}));

vi.mock("../src/housingSync/menus/paginatedList", () => ({
    getPaginatedListPageForIndex: () => 1,
    getPaginatedListSlotAtIndex: vi.fn(async () => mocks.slot),
    getVisiblePaginatedItemSlots: vi.fn(() => []),
    goToPaginatedListPage: vi.fn(async () => undefined),
    isEmptyPaginatedPlaceholder: vi.fn(() => false),
    readPaginatedList: vi.fn(async () => [
        {
            index: 0,
            slotId: 4,
            slot: mocks.slot,
            condition: { type: "BLOCK_TYPE", itemName: "Stone" },
        },
    ]),
}));

vi.mock("../src/housingSync/menus/menuWait", () => ({
    timedWaitForMenu: vi.fn(async () => undefined),
}));

vi.mock("../src/housingSync/menus/menuUtils", () => ({
    clickGoBack: vi.fn(async () => undefined),
}));

import { readConditionList } from "../src/housingSync/actions/conditions/readList";

describe("condition item capture", () => {
    test("exports Block Type through the block-reference capture path", async () => {
        const observed = await readConditionList({} as never, {
            itemReadMode: "export",
            itemCaptures: {} as never,
        });

        expect(mocks.captureBlockReference).toHaveBeenCalledOnce();
        expect(mocks.captureItem).not.toHaveBeenCalled();
        expect(observed[0].condition).toMatchObject({
            type: "BLOCK_TYPE",
            itemName: "minecraft:stone",
        });
    });
});
