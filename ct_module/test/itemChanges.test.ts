import { describe, expect, it } from "vitest";
import type { ImportableItem } from "htsw/types";

import {
    itemChangeLines,
    itemChanges,
} from "../src/importables/itemChanges";
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

        expect(changes.nbt).toEqual([
            'tag.display.Name: "Old name" -> "New name"',
        ]);
        expect(itemChangeLines(changes)).toEqual([
            'tag.display.Name: "Old name" -> "New name"',
            "Right click actions changed",
        ]);
    });
});
