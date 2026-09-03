import { describe, expect, test } from "vitest";
import type { Tag } from "htsw/nbt";
import type { Action, Importable, ImportableItem } from "htsw/types";

import {
    capturedItemFieldContent,
    sourceItemFieldContent,
} from "../src/housingSync/items/fieldContent";
import type { CapturedItem } from "../src/importables/items/captureRegistry";
import { canonicalItemShellTagKey } from "../src/housingSync/items/itemNbt";
import { createProjectItemIndex } from "../src/importables/items/projectItems";

const stone = (count?: number): Tag => ({
    type: "compound",
    value: {
        id: { type: "string", value: "minecraft:stone" },
        ...(count === undefined
            ? {}
            : { Count: { type: "byte", value: count } }),
    },
});

const declared: ImportableItem = { type: "ITEM", name: "key", nbt: stone() };

function give(itemName: string): Action {
    return { type: "GIVE_ITEM", itemName };
}

function owner(actions: Action[]): Importable {
    return { type: "FUNCTION", name: "stock up", actions };
}

describe("item field content", () => {
    test("a counted source reference resolves to the restacked item", () => {
        const stacked = give("key@8");
        const importable = owner([stacked]);

        const content = sourceItemFieldContent(
            importable,
            createProjectItemIndex([declared, importable])
        );

        expect(content(stacked, "itemName")).toBe(
            canonicalItemShellTagKey(stone(8))
        );
    });

    test("a counted capture reference resolves through the base capture", () => {
        const stacked = give("key@8");
        const plain = give("key");
        const importable = owner([stacked, plain]);
        const captures: CapturedItem[] = [
            {
                name: "key",
                snbt: '{id:"minecraft:stone"}',
                displayName: "Stone",
                seeded: false,
            },
        ];

        const content = capturedItemFieldContent(importable, captures);

        expect(content(stacked, "itemName")).toBe(
            canonicalItemShellTagKey(stone(8))
        );
        expect(content(plain, "itemName")).toBe(canonicalItemShellTagKey(stone()));
    });
});
