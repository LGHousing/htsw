import { describe, expect, it } from "vitest";

import { buildChestMenuEntry } from "../src/importables/menus/exportChest";

describe("buildChestMenuEntry", () => {
    it("derives row count only for complete rows", () => {
        expect(buildChestMenuEntry("small", 27, [])).toEqual({
            name: "small",
            size: 3,
            slots: [],
        });
        expect(buildChestMenuEntry("large", 54, [])).toEqual({
            name: "large",
            size: 6,
            slots: [],
        });
        expect(buildChestMenuEntry("odd", 10, [])).toEqual({
            name: "odd",
            slots: [],
        });
    });

    it("shapes sparse slots into item references", () => {
        expect(
            buildChestMenuEntry("loot", 27, [
                { slot: 2, itemName: "stone" },
                { slot: 19, itemName: "gold_2" },
            ])
        ).toEqual({
            name: "loot",
            size: 3,
            slots: [
                { slot: 2, nbt: "items/stone.snbt" },
                { slot: 19, nbt: "items/gold_2.snbt" },
            ],
        });
    });
});
