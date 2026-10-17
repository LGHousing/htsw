import { describe, expect, test } from "vitest";
import { items as itemReferences } from "htsw";
import { MINECRAFT_ITEMS, type ImportableItem } from "htsw/types";

import { canonicalVanillaItemCompareName } from "../src/housingSync/items/itemReferences";
import {
    createProjectItemIndex,
    type ProjectItem,
} from "../src/importables/items/projectItems";

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

describe("item reference stack counts", () => {
    const declared = (): ImportableItem => ({
        type: "ITEM",
        name: "Coin",
        nbt: {
            type: "compound",
            value: {
                id: { type: "string", value: "minecraft:gold_nugget" },
                Count: { type: "byte", value: 1 },
            },
        },
    });

    const countOf = (entry: ProjectItem | undefined): unknown =>
        entry?.nbt.type === "compound" ? entry.nbt.value.Count : undefined;

    test("applies a count suffix to a declared item", () => {
        const items = createProjectItemIndex([declared()]);
        const entry = items.resolve("Coin@8");

        expect(entry?.source).toBe("named");
        expect(entry?.count).toBe(8);
        expect(countOf(entry)).toEqual({ type: "byte", value: 8 });
        expect(entry?.importable?.name).toBe("Coin");
    });

    test("applies a count suffix to a vanilla reference", () => {
        const entry = createProjectItemIndex([]).resolve("red_wool@16");

        expect(entry?.source).toBe("vanilla");
        expect(countOf(entry)).toEqual({ type: "byte", value: 16 });
    });

    test("leaves the declaration's own stack size alone", () => {
        const importable = declared();
        const items = createProjectItemIndex([importable]);

        items.resolve("Coin@64");

        expect(countOf(items.resolve("Coin"))).toEqual({ type: "byte", value: 1 });
        expect(
            importable.nbt.type === "compound" ? importable.nbt.value.Count : undefined
        ).toEqual({ type: "byte", value: 1 });
    });

    test("hands back one stable entry per reference", () => {
        const items = createProjectItemIndex([declared()]);

        // Compared with `===` rather than `toBe`: a mismatch would make vitest
        // diff the entries, and that touches the lazy `item` getter, which
        // needs a Minecraft runtime.
        expect(items.resolve("Coin@8") === items.resolve("Coin@8")).toBe(true);
        expect(items.resolve("Coin@8") === items.resolve("Coin@4")).toBe(false);
    });

    test("ignores an out-of-range count, which checkItems rejects", () => {
        const items = createProjectItemIndex([declared()]);

        expect(items.resolve("Coin@0") === items.resolve("Coin")).toBe(true);
        expect(items.resolve("Coin@65") === items.resolve("Coin")).toBe(true);
    });

    test("does not treat a non-numeric suffix as a count", () => {
        expect(createProjectItemIndex([declared()]).resolve("Coin@x")).toBeUndefined();
    });
});
