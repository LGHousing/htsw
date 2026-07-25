import { describe, expect, test } from "vitest";

import {
    canonicalItemShellTag,
    canonicalLiveItemTag,
    type TagLike,
} from "../src/housingSync/items/itemTag";
import {
    canonicalItemShellTagKey,
    normalizeItemSnbtForExport,
} from "../src/housingSync/items/itemNbt";

const str = (value: string): TagLike => ({ type: "string", value });
const byte = (value: number): TagLike => ({ type: "byte", value });
const short = (value: number): TagLike => ({ type: "short", value });
const compound = (value: Record<string, TagLike>): TagLike => ({
    type: "compound",
    value,
});
const loreList = (lines: string[]): TagLike => ({
    type: "list",
    value: { type: "string", value: lines },
});

describe("canonicalItemShellTag", () => {
    test("source {id,Count} equals read-back with vanilla defaults", () => {
        const source = compound({ id: str("minecraft:stone"), Count: byte(1) });
        const house = compound({
            id: str("minecraft:stone"),
            Count: byte(1),
            Damage: short(0),
            tag: compound({ display: compound({}) }),
        });
        expect(canonicalItemShellTag(source)).toEqual(canonicalItemShellTag(house));
    });

    test("real damage, counts, and interact_data are handled correctly", () => {
        const plain = compound({ id: str("minecraft:wool") });
        const damaged = compound({ id: str("minecraft:wool"), Damage: short(5) });
        expect(canonicalItemShellTag(plain)).not.toEqual(canonicalItemShellTag(damaged));

        const stacked = compound({ id: str("minecraft:wool"), Count: byte(16) });
        expect(canonicalItemShellTag(plain)).not.toEqual(canonicalItemShellTag(stacked));

        const withInteract = compound({
            id: str("minecraft:wool"),
            tag: compound({
                ExtraAttributes: compound({ interact_data: str("blob") }),
            }),
        });
        expect(canonicalItemShellTag(withInteract)).toEqual(canonicalItemShellTag(plain));
    });

    test("server-stripped ItemModel equals the source that carried it", () => {
        // Verified in-game: a creative spawn with
        // tag:{ItemModel:"minecraft:netherite_spear"} echoes back with tag:{}.
        const source = compound({
            id: str("minecraft:iron_sword"),
            Count: byte(1),
            tag: compound({ ItemModel: str("minecraft:netherite_spear") }),
        });
        const echoed = compound({
            id: str("minecraft:iron_sword"),
            Count: byte(1),
            Damage: short(0),
            tag: compound({}),
        });
        expect(canonicalItemShellTag(source)).toEqual(canonicalItemShellTag(echoed));

        const otherModel = compound({
            id: str("minecraft:iron_sword"),
            Count: byte(1),
            tag: compound({
                ItemModel: str("minecraft:other"),
                display: compound({ Name: str("§6Named") }),
            }),
        });
        const plainNamed = compound({
            id: str("minecraft:iron_sword"),
            Count: byte(1),
            tag: compound({ display: compound({ Name: str("§6Named") }) }),
        });
        expect(canonicalItemShellTag(otherModel)).toEqual(
            canonicalItemShellTag(plainNamed)
        );
    });

    test("bare item ids normalize to the minecraft namespace", () => {
        expect(canonicalItemShellTag(compound({ id: str("stone") }))).toEqual(
            canonicalItemShellTag(compound({ id: str("minecraft:stone") }))
        );
    });

    test("integral tag widths fold: server's re-typed byte equals the source int", () => {
        // Verified in-game: an injected skull with `hypixelPopulated: 1` (int)
        // echoes back from the server as `1b` (byte).
        const int = (value: number): TagLike => ({ type: "int", value });
        const source = compound({
            id: str("minecraft:skull"),
            Damage: short(3),
            tag: compound({ SkullOwner: compound({ hypixelPopulated: int(1) }) }),
        });
        const echoed = compound({
            id: str("minecraft:skull"),
            Damage: byte(3),
            tag: compound({ SkullOwner: compound({ hypixelPopulated: byte(1) }) }),
        });
        expect(canonicalItemShellTag(source)).toEqual(canonicalItemShellTag(echoed));

        // Values still matter — only the width is folded.
        const other = compound({
            id: str("minecraft:skull"),
            Damage: short(3),
            tag: compound({ SkullOwner: compound({ hypixelPopulated: int(0) }) }),
        });
        expect(canonicalItemShellTag(source)).not.toEqual(canonicalItemShellTag(other));
    });

    test("integral widths fold inside compound lists (ench entries)", () => {
        const int = (value: number): TagLike => ({ type: "int", value });
        const enchList = (lvl: TagLike, id: TagLike): TagLike => ({
            type: "list",
            value: { type: "compound", value: [{ lvl, id }] },
        });
        const source = compound({
            id: str("minecraft:skull"),
            tag: compound({ ench: enchList(short(1), short(17)) }),
        });
        const retyped = compound({
            id: str("minecraft:skull"),
            tag: compound({ ench: enchList(int(1), int(17)) }),
        });
        expect(canonicalItemShellTag(source)).toEqual(canonicalItemShellTag(retyped));
    });

    test('blank lore separators "" and "§7" are DISTINCT identities', () => {
        // Housing preserves whichever blank-separator form was authored, and
        // its Metadata check distinguishes them, so two items differing only
        // here are different items. Folding them together made a referencing
        // action silently bind the wrong variant.
        const withBlank = compound({
            id: str("minecraft:stone"),
            tag: compound({
                display: compound({
                    Name: str("§6Fancy"),
                    Lore: loreList(["§7line", "", "§eend"]),
                }),
            }),
        });
        const houseForm = compound({
            id: str("minecraft:stone"),
            tag: compound({
                display: compound({
                    Name: str("§6Fancy"),
                    Lore: loreList(["§7line", "§7", "§eend"]),
                }),
            }),
        });
        const snapshot = JSON.parse(JSON.stringify(withBlank)) as TagLike;
        expect(canonicalItemShellTag(withBlank)).not.toEqual(
            canonicalItemShellTag(houseForm)
        );
        expect(canonicalItemShellTagKey(withBlank)).not.toEqual(
            canonicalItemShellTagKey(houseForm)
        );
        expect(withBlank).toEqual(snapshot);
    });

    test("a blank lore separator survives export verbatim", () => {
        // The exported snbt is ground truth: rewriting "" to "§7" on the way
        // out made the two variants byte-identical on disk, so you could not
        // tell which one a project had captured.
        expect(normalizeItemSnbtForExport('{id:"minecraft:stone",tag:{display:{Lore:["a","","b"]}}}')).toContain(
            '""'
        );
    });

    test("Drop Item's empty ExtraAttributes remains part of exact metadata identity", () => {
        const plain = compound({ id: str("minecraft:diamond_sword") });
        const marked = compound({
            id: str("minecraft:diamond_sword"),
            tag: compound({ ExtraAttributes: compound({}) }),
        });
        expect(canonicalItemShellTag(plain)).not.toEqual(canonicalItemShellTag(marked));
    });

    test("authored empty lists remain part of item identity", () => {
        const plain = compound({ id: str("minecraft:stone") });
        const withEmptyList = compound({
            id: str("minecraft:stone"),
            tag: compound({ AuthoredValues: loreList([]) }),
        });

        expect(canonicalItemShellTagKey(withEmptyList)).not.toBe(
            canonicalItemShellTagKey(plain)
        );
    });

    test("authored empty compounds are preserved regardless of their key", () => {
        const plain = compound({ id: str("minecraft:diamond_sword") });
        const custom = compound({
            id: str("minecraft:diamond_sword"),
            tag: compound({ custom: compound({}) }),
        });
        const nestedExtraAttributes = compound({
            id: str("minecraft:diamond_sword"),
            tag: compound({ container: compound({ ExtraAttributes: compound({}) }) }),
        });
        expect(canonicalItemShellTag(plain)).not.toEqual(canonicalItemShellTag(custom));
        expect(canonicalItemShellTag(plain)).not.toEqual(
            canonicalItemShellTag(nestedExtraAttributes)
        );
    });

    test("known empty server shells are stripped", () => {
        const plain = compound({ id: str("minecraft:diamond_sword") });
        const emptyTag = compound({
            id: str("minecraft:diamond_sword"),
            tag: compound({}),
        });
        const emptyDisplay = compound({
            id: str("minecraft:diamond_sword"),
            tag: compound({ display: compound({}) }),
        });
        expect(canonicalItemShellTag(plain)).toEqual(canonicalItemShellTag(emptyTag));
        expect(canonicalItemShellTag(plain)).toEqual(canonicalItemShellTag(emptyDisplay));
    });

    test("server-only fields do not erase unrelated empty compounds", () => {
        const source = compound({
            id: str("minecraft:diamond_sword"),
            tag: compound({
                ItemModel: str("minecraft:netherite_spear"),
                ExtraAttributes: compound({
                    interact_data: str("blob"),
                    marker: compound({}),
                }),
            }),
        });
        const expected = compound({
            id: str("minecraft:diamond_sword"),
            tag: compound({
                ExtraAttributes: compound({ marker: compound({}) }),
            }),
        });
        expect(canonicalItemShellTag(source)).toEqual(canonicalItemShellTag(expected));
        expect(canonicalItemShellTag(source)).not.toEqual(
            canonicalItemShellTag(compound({ id: str("minecraft:diamond_sword") }))
        );
    });

    test("portable identity ignores click actions while live identity preserves them", () => {
        const first = compound({
            id: str("minecraft:stone"),
            tag: compound({
                ExtraAttributes: compound({
                    interact_data: compound({ version: byte(1) }),
                }),
            }),
        });
        const second = compound({
            id: str("minecraft:stone"),
            tag: compound({
                ExtraAttributes: compound({
                    interact_data: compound({ version: byte(2) }),
                }),
            }),
        });
        expect(canonicalItemShellTag(first)).toEqual(canonicalItemShellTag(second));
        expect(canonicalLiveItemTag(first)).not.toEqual(canonicalLiveItemTag(second));
    });
});
