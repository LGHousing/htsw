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
                const override =
                    itemReferences.VANILLA_VARIATION_REFERENCE_OVERRIDES[reference];
                if (
                    override !== undefined &&
                    (override.id !== `minecraft:${item.name}` ||
                        override.damage !== variation.metadata)
                ) {
                    continue;
                }
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

    test.each([
        ["acacia_wood", "minecraft:log2", 0],
        ["minecraft:acacia_wood", "minecraft:log2", 0],
        ["dark_oak_wood", "minecraft:log2", 1],
        ["minecraft:dark_oak_wood", "minecraft:log2", 1],
        ["wooden_slab", "minecraft:wooden_slab", 0],
        ["minecraft:wooden_slab", "minecraft:wooden_slab", 0],
    ])("resolves overridden variation %s", (reference, id, damage) => {
        const entry = createProjectItemIndex([]).resolve(reference);
        expect(entry?.nbt.type).toBe("compound");
        if (entry?.nbt.type !== "compound") return;
        expect(entry.nbt.value.id).toEqual({ type: "string", value: id });
        expect(entry.nbt.value.Damage).toEqual({ type: "short", value: damage });
    });

    test("does not canonicalize the junk log damage as the log2 override", () => {
        expect(canonicalVanillaItemCompareName("Oak Wood")).not.toBe(
            canonicalVanillaItemCompareName("acacia_wood")
        );
    });
});
