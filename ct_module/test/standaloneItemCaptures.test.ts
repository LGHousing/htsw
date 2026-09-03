import { describe, expect, test } from "vitest";
import * as htsw from "htsw";
import { MINECRAFT_ITEMS } from "htsw/types";

import { StandaloneItemCaptures } from "../src/gui/export/standaloneItemCaptures";

const vanillaStone = '{id:"minecraft:stone",Count:1b,Damage:0s}';
const magicSword =
    '{id:"minecraft:diamond_sword",Count:1b,Damage:0s,tag:{display:{Name:"Magic Sword"},custom:1b}}';

describe("StandaloneItemCaptures", () => {
    test("returns a base vanilla reference from captured NBT", () => {
        const captures = new StandaloneItemCaptures(() => null);

        expect(captures.register(vanillaStone, "Stone")).toBe("minecraft:stone");
        expect(captures.entriesToWrite()).toEqual([]);
    });

    test("returns a damage-variant vanilla reference from captured NBT", () => {
        const captures = new StandaloneItemCaptures(() => null);

        expect(
            captures.register('{id:"minecraft:wool",Count:1b,Damage:14s}', "Red Wool")
        ).toBe("red_wool");
        expect(captures.entriesToWrite()).toEqual([]);
    });

    test("captures a vanilla stack with a non-default count", () => {
        const captures = new StandaloneItemCaptures(() => null);

        expect(
            captures.register('{id:"minecraft:stone",Count:16b,Damage:0s}', "Stone")
        ).toBe("items/stone.snbt");
    });

    test("captures a vanilla item with a custom display name", () => {
        const captures = new StandaloneItemCaptures(() => null);

        expect(
            captures.register(
                '{id:"minecraft:stone",Count:1b,Damage:0s,tag:{display:{Name:"Special Stone"}}}',
                "Special Stone"
            )
        ).toBe("items/special_stone.snbt");
    });

    test("names an unnamed captured item from its vanilla damage variation", () => {
        const greenPane = MINECRAFT_ITEMS.find(
            (entry) => entry.name === "stained_glass_pane"
        )?.variations?.find((entry) => entry.metadata === 13);
        expect(greenPane).toBeDefined();
        expect(
            htsw.items.vanillaVariationReferenceName(greenPane?.displayName ?? "")
        ).toBe("green_stained_glass_pane");
        const captures = new StandaloneItemCaptures(() => null);

        expect(
            captures.register(
                '{id:"minecraft:stained_glass_pane",Count:2b,Damage:13s}',
                ""
            )
        ).toBe("items/green_stained_glass_pane.snbt");
    });

    test("captures and deduplicates custom items by live NBT", () => {
        const captures = new StandaloneItemCaptures(() => null);

        expect(captures.register(magicSword, "&dMagic Sword")).toBe(
            "items/magic_sword.snbt"
        );
        expect(captures.register(magicSword, "Renamed Sword")).toBe(
            "items/magic_sword.snbt"
        );
        expect(captures.entriesToWrite()).toEqual([
            {
                reference: "items/magic_sword.snbt",
                snbt: magicSword,
                hasClickActions: false,
            },
        ]);
    });

    test("suffixes colliding display-name slugs", () => {
        const captures = new StandaloneItemCaptures(() => null);

        expect(captures.register(magicSword, "Magic Sword")).toBe(
            "items/magic_sword.snbt"
        );
        expect(
            captures.register(magicSword.replace("custom:1b", "custom:2b"), "Magic Sword")
        ).toBe("items/magic_sword_2.snbt");
    });

    test("reuses identical existing content without writing it", () => {
        const captures = new StandaloneItemCaptures((reference) =>
            reference === "items/magic_sword.snbt"
                ? '{ tag: { custom: 1b, display: { Name: "Magic Sword" } }, Damage: 0s, Count: 1b, id: "minecraft:diamond_sword" }'
                : null
        );

        expect(captures.register(magicSword, "Magic Sword")).toBe(
            "items/magic_sword.snbt"
        );
        expect(captures.entriesToWrite()).toEqual([]);
    });

    test("does not overwrite different existing content", () => {
        const captures = new StandaloneItemCaptures((reference) =>
            reference === "items/magic_sword.snbt" ? vanillaStone : null
        );

        expect(captures.register(magicSword, "Magic Sword")).toBe(
            "items/magic_sword_2.snbt"
        );
        expect(captures.entriesToWrite()[0].reference).toBe("items/magic_sword_2.snbt");
    });

    test("flags raw interact_data", () => {
        const captures = new StandaloneItemCaptures(() => null);
        const withClickActions = magicSword.replace(
            "custom:1b",
            "custom:1b,ExtraAttributes:{interact_data:{version:1}}"
        );

        captures.register(withClickActions, "Magic Sword");

        expect(captures.entriesToWrite()[0].hasClickActions).toBe(true);
        expect(captures.clickActionItemCount()).toBe(1);
    });

    test("counts click actions in a reused existing item", () => {
        const withClickActions = magicSword.replace(
            "custom:1b",
            "custom:1b,ExtraAttributes:{interact_data:{version:1}}"
        );
        const captures = new StandaloneItemCaptures(() => withClickActions);

        captures.register(withClickActions, "Magic Sword");

        expect(captures.entriesToWrite()).toEqual([]);
        expect(captures.clickActionItemCount()).toBe(1);
    });

    test("returns a vanilla id for a bare block payload", () => {
        const captures = new StandaloneItemCaptures(() => null);

        expect(
            captures.registerBlockReference(
                '{id:"minecraft:stone",Count:1b,Damage:0s,tag:{display:{}}}',
                "Stone"
            )
        ).toBe("minecraft:stone");
        expect(captures.entriesToWrite()).toEqual([]);
    });
});
