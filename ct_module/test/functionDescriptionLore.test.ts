import { describe, expect, test } from "vitest";

import { parseFunctionDescriptionLore } from "../src/importables/functions/housing";

describe("parseFunctionDescriptionLore", () => {
    test("a function without a description reads as undefined", () => {
        expect(
            parseFunctionDescriptionLore([
                "§7Edit the description of this function.",
                "",
                "§eClick to rename!",
            ])
        ).toBeUndefined();
    });

    test("reads a single-line description", () => {
        expect(
            parseFunctionDescriptionLore([
                "§7Edit the description of this function.",
                "",
                "§7Runs every second.",
                "",
                "§eClick to rename!",
            ])
        ).toBe("Runs every second.");
    });

    test("joins a wrapped description with a single space", () => {
        expect(
            parseFunctionDescriptionLore([
                "§7Edit the description of this function.",
                "",
                "§7Runs every second and",
                "§7counts clicks.",
                "",
                "§eClick to rename!",
            ])
        ).toBe("Runs every second and counts clicks.");
    });

    test("stops at the formatted rename sentinel", () => {
        const description = parseFunctionDescriptionLore([
            "§o§aEdit Description§r (#0340)",
            "§5§o§7Edit the description of this function.",
            "§5§o",
            "§5§o§eClick to rename!",
            "§8minecraft:book",
            "§8NBT: 1 tag(s)",
            "§f(Miscellaneous)",
            "§6Tags(1): §edisplay",
        ]);
        expect(description).toBeUndefined();
    });

    test("throws when the lore has no separator", () => {
        expect(() => parseFunctionDescriptionLore(["§eClick to rename!"])).toThrow(
            "Could not read function description."
        );
    });
});
