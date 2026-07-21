import { describe, expect, it } from "vitest";
import type { ImportableItem } from "htsw/types";

import { itemChangeLines, itemChanges } from "../src/importables/items/changes";
import type { TagLike } from "../src/housingSync/items/itemTag";
import { message } from "./utils";

function item(name: string, displayName: string): ImportableItem {
    return {
        type: "ITEM",
        name,
        nbt: {
            type: "compound",
            value: {
                id: { type: "string", value: "minecraft:stained_glass" },
                tag: {
                    type: "compound",
                    value: {
                        display: {
                            type: "compound",
                            value: {
                                Name: { type: "string", value: displayName },
                            },
                        },
                    },
                },
            },
        },
    };
}

describe("itemChanges", () => {
    it("reports changed NBT paths and click-action sides", () => {
        const house = item("glass", "Old name");
        const file = item("glass", "New name");
        file.rightClickActions = [message("new")];

        const changes = itemChanges(file, house);

        expect(changes.nbt).toEqual(['tag.display.Name: "Old name" -> "New name"']);
        expect(itemChangeLines(changes)).toEqual([
            'tag.display.Name: "Old name" -> "New name"',
            "Right click actions changed",
        ]);
    });

    it("reports added and removed empty compounds", () => {
        const plain = item("glass", "Same name");
        const marked = item("glass", "Same name");
        const root = marked.nbt.value as Record<string, TagLike>;
        const tag = root["tag"].value as Record<string, TagLike>;
        tag["ExtraAttributes"] = { type: "compound", value: {} };

        expect(itemChanges(marked, plain).nbt).toEqual([
            "tag.ExtraAttributes: (missing) -> {}",
        ]);
        expect(itemChanges(plain, marked).nbt).toEqual([
            "tag.ExtraAttributes: {} -> (missing)",
        ]);
    });
});
