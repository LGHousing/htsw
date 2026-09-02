import { describe, expect, test } from "vitest";

import { itemLore } from "../src/utils/itemLore";

const TOOLTIP_JUNK = [
    "§o§aEdit Description§r (#0340)",
    "§5§o§7Edit the description of this function.",
    "§5§o",
    "§5§o§eClick to rename!",
    "§8minecraft:book",
    "§8NBT: 1 tag(s)",
    "§f(Miscellaneous)",
    "§6Tags(1): §edisplay",
];

function nbtString(value: string) {
    return {
        getClass: () => ({ getSimpleName: () => "NBTTagString" }),
        func_150285_a_: () => value,
    };
}

function nbtList(entries: unknown[]) {
    return {
        getClass: () => ({ getSimpleName: () => "NBTTagList" }),
        func_74745_c: () => entries.length,
        func_179238_g: (index: number) => entries[index],
    };
}

function nbtCompound(entries: Record<string, unknown>) {
    return {
        getClass: () => ({ getSimpleName: () => "NBTTagCompound" }),
        func_74781_a: (key: string) => entries[key] ?? null,
    };
}

function itemWithTag(tag: unknown) {
    return {
        getItemStack: () => ({ func_77978_p: () => tag }),
        getLore: () => TOOLTIP_JUNK,
    } as never;
}

describe("itemLore", () => {
    test("reads display.Lore from NBT, never the rendered tooltip", () => {
        const item = itemWithTag(
            nbtCompound({
                display: nbtCompound({
                    Lore: nbtList([
                        nbtString("§7Edit the description of this function."),
                        nbtString(""),
                        nbtString("§eClick to rename!"),
                    ]),
                }),
            })
        );
        expect(itemLore(item)).toEqual([
            "§7Edit the description of this function.",
            "",
            "§eClick to rename!",
        ]);
    });

    test("returns an empty list when the stack has no tag", () => {
        expect(itemLore(itemWithTag(null))).toEqual([]);
    });

    test("returns an empty list without a display compound", () => {
        expect(itemLore(itemWithTag(nbtCompound({})))).toEqual([]);
    });

    test("returns an empty list without a Lore list", () => {
        expect(itemLore(itemWithTag(nbtCompound({ display: nbtCompound({}) })))).toEqual(
            []
        );
    });

    test("ignores a display key that is not a compound", () => {
        expect(itemLore(itemWithTag(nbtCompound({ display: nbtString("x") })))).toEqual(
            []
        );
    });

    test("falls back to getLore for test doubles without an item stack", () => {
        const double = { getLore: () => ["a", "b"] } as never;
        expect(itemLore(double)).toEqual(["a", "b"]);
    });
});
