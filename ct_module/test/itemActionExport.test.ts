import { describe, expect, test } from "vitest";

import {
    itemActionSummaryHasActions,
    itemActionPaths,
    itemIdFromNbt,
    itemNbtHasInteractData,
} from "../src/importables/items/exportLogic";

describe("item action export logic", () => {
    test("builds canonical left and right output paths", () => {
        expect(itemActionPaths("./exports", "§aMagic Wand!")).toEqual({
            left: "./exports/_00a7aMagic_Wand_0021_left.htsl",
            right: "./exports/_00a7aMagic_Wand_0021_right.htsl",
        });
    });

    test("recognizes empty and populated action summaries", () => {
        expect(itemActionSummaryHasActions(["§7Actions:", "§8- None"])).toBe(false);
        expect(itemActionSummaryHasActions(["other", "§7Actions:", "§a- Send a Message"])).toBe(true);
        expect(itemActionSummaryHasActions(["§7No summary"])).toBe(false);
    });

    test("finds interact_data without depending on its encrypted value type", () => {
        const nbt = {
            type: "compound" as const,
            value: {
                id: { type: "string" as const, value: "minecraft:book" },
                tag: {
                    type: "compound" as const,
                    value: {
                        ExtraAttributes: {
                            type: "compound" as const,
                            value: { interact_data: { type: "byte_array" as const, value: [1, 2] } },
                        },
                    },
                },
            },
        };
        expect(itemNbtHasInteractData(nbt)).toBe(true);
        expect(itemIdFromNbt(nbt)).toBe("minecraft:book");
    });
});
