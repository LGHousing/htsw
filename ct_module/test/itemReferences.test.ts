import { describe, expect, test } from "vitest";
import { items as itemReferences } from "htsw";
import { MINECRAFT_ITEMS } from "htsw/types";

import { canonicalVanillaItemCompareName } from "../src/housingSync/items/itemReferences";
import { createProjectItemIndex } from "../src/importables/items/projectItems";

describe("vanilla item references", () => {
    test("every accepted variation name matches its observed display name", () => {
        for (const item of MINECRAFT_ITEMS) {
            for (const variation of item.variations ?? []) {
                const reference = itemReferences.vanillaVariationReferenceName(
                    variation.displayName
                );
                const resolved = itemReferences.resolveVanillaItemReference(reference);
                if (resolved === undefined) continue;

                expect(canonicalVanillaItemCompareName(reference)).toBe(
                    canonicalVanillaItemCompareName(variation.displayName)
                );
                expect(canonicalVanillaItemCompareName(`minecraft:${reference}`)).toBe(
                    canonicalVanillaItemCompareName(variation.displayName)
                );
            }
        }
    });

    test("the action item resolver keeps variation damage", () => {
        const items = createProjectItemIndex([]);
        const entry = items.resolve("red_wool");
        expect(entry?.source).toBe("vanilla");
        expect(entry?.nbt.type).toBe("compound");
        if (entry?.nbt.type !== "compound") return;
        expect(entry.nbt.value.id).toEqual({
            type: "string",
            value: "minecraft:wool",
        });
        expect(entry.nbt.value.Damage).toEqual({ type: "short", value: 14 });
        expect(items.canonicalizeObservedName("Red Wool")).toBe("red_wool");
    });
});
