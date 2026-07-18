import { describe, expect, test } from "vitest";

import {
    itemIdFromNbt,
    itemNbtHasInteractData,
} from "../src/importables/items/exportLogic";
import { actionPath, actionReference } from "../src/importables/items/clickActionsExport";
import { declaredItemActionCandidates } from "../src/importables/items/export";

describe("item action export logic", () => {
    test("derives action paths and references beside the item", () => {
        expect(actionPath("./items/wand.snbt", "left")).toBe("./items/wand_left.htsl");
        expect(actionReference("items/wand.snbt", "right")).toBe("items/wand_right.htsl");
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
        const plain = { type: "compound" as const, value: { id: nbt.value.id } };
        const commandBlockNbt = {
            ...nbt,
            value: {
                ...nbt.value,
                id: { type: "string" as const, value: "minecraft:command_block" },
            },
        };
        const selection = declaredItemActionCandidates({
            importJsonPath: "./import.json",
            rootDir: ".",
            names: ["wand"],
            projectItems: [
                { type: "ITEM", name: "wand", nbt },
                { type: "ITEM", name: "plain", nbt: plain },
                { type: "ITEM", name: "blocked", nbt: commandBlockNbt },
            ],
        });
        expect(selection.candidates.map((item) => item.name)).toEqual(["wand"]);
        expect(selection.unspawnable).toEqual([]);

        const all = declaredItemActionCandidates({
            importJsonPath: "./import.json",
            rootDir: ".",
            projectItems: [
                { type: "ITEM", name: "wand", nbt },
                { type: "ITEM", name: "blocked", nbt: commandBlockNbt },
            ],
        });
        expect(all.candidates.map((item) => item.name)).toEqual(["wand"]);
        expect(all.unspawnable.map(({ item, itemId }) => [item.name, itemId])).toEqual([
            ["blocked", "minecraft:command_block"],
        ]);
    });
});
