import { describe, expect, test } from "vitest";

import {
    canonicalItemTag,
    type TagLike,
} from "../src/housingSync/fields/itemTagCanonical";

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

describe("canonicalItemTag", () => {
    test("source {id,Count} equals read-back with vanilla defaults", () => {
        const source = compound({ id: str("minecraft:stone"), Count: byte(1) });
        const house = compound({
            id: str("minecraft:stone"),
            Count: byte(1),
            Damage: short(0),
            tag: compound({ display: compound({}) }),
        });
        expect(canonicalItemTag(source)).toEqual(canonicalItemTag(house));
    });

    test("real damage, counts, and interact_data are handled correctly", () => {
        const plain = compound({ id: str("minecraft:wool") });
        const damaged = compound({ id: str("minecraft:wool"), Damage: short(5) });
        expect(canonicalItemTag(plain)).not.toEqual(canonicalItemTag(damaged));

        const stacked = compound({ id: str("minecraft:wool"), Count: byte(16) });
        expect(canonicalItemTag(plain)).not.toEqual(canonicalItemTag(stacked));

        const withInteract = compound({
            id: str("minecraft:wool"),
            tag: compound({
                ExtraAttributes: compound({ interact_data: str("blob") }),
            }),
        });
        expect(canonicalItemTag(withInteract)).toEqual(canonicalItemTag(plain));
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
        expect(canonicalItemTag(source)).toEqual(canonicalItemTag(echoed));

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
        expect(canonicalItemTag(otherModel)).toEqual(canonicalItemTag(plainNamed));
    });

    test("bare item ids normalize to the minecraft namespace", () => {
        expect(canonicalItemTag(compound({ id: str("stone") }))).toEqual(
            canonicalItemTag(compound({ id: str("minecraft:stone") }))
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
        expect(canonicalItemTag(source)).toEqual(canonicalItemTag(echoed));

        // Values still matter — only the width is folded.
        const other = compound({
            id: str("minecraft:skull"),
            Damage: short(3),
            tag: compound({ SkullOwner: compound({ hypixelPopulated: int(0) }) }),
        });
        expect(canonicalItemTag(source)).not.toEqual(canonicalItemTag(other));
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
        expect(canonicalItemTag(source)).toEqual(canonicalItemTag(retyped));
    });

    test("blank lore separators equal Housing's §7 form, without mutating input", () => {
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
        expect(canonicalItemTag(withBlank)).toEqual(canonicalItemTag(houseForm));
        expect(withBlank).toEqual(snapshot);
    });

    test("Drop Item's empty ExtraAttributes remains part of exact metadata identity", () => {
        const plain = compound({ id: str("minecraft:diamond_sword") });
        const marked = compound({
            id: str("minecraft:diamond_sword"),
            tag: compound({ ExtraAttributes: compound({}) }),
        });
        expect(canonicalItemTag(plain)).not.toEqual(canonicalItemTag(marked));
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
        expect(canonicalItemTag(plain)).not.toEqual(canonicalItemTag(custom));
        expect(canonicalItemTag(plain)).not.toEqual(canonicalItemTag(nestedExtraAttributes));
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
        expect(canonicalItemTag(plain)).toEqual(canonicalItemTag(emptyTag));
        expect(canonicalItemTag(plain)).toEqual(canonicalItemTag(emptyDisplay));
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
        expect(canonicalItemTag(source)).toEqual(canonicalItemTag(expected));
        expect(canonicalItemTag(source)).not.toEqual(
            canonicalItemTag(compound({ id: str("minecraft:diamond_sword") }))
        );
    });
});
