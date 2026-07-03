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

    test("bare item ids normalize to the minecraft namespace", () => {
        expect(canonicalItemTag(compound({ id: str("stone") }))).toEqual(
            canonicalItemTag(compound({ id: str("minecraft:stone") }))
        );
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
        const snapshot = JSON.parse(JSON.stringify(withBlank));
        expect(canonicalItemTag(withBlank)).toEqual(canonicalItemTag(houseForm));
        expect(withBlank).toEqual(snapshot);
    });
});
