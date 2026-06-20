import { describe, expect, test } from "vitest";

import { tokenizeSnbt } from "../src/gui/right-panel/syntax";

const GOLD = 0xffffaa00 | 0;
const GRAY = 0xffaaaaaa | 0;
const DARK_GRAY = 0xff555555 | 0;

function joined(line: string): string {
    return tokenizeSnbt(line)
        .map((t) => t.text)
        .join("");
}

function luminance(color: number): number {
    const r = (color >>> 16) & 0xff;
    const g = (color >>> 8) & 0xff;
    const b = color & 0xff;
    return 0.299 * r + 0.587 * g + 0.114 * b;
}

describe("tokenizeSnbt", () => {
    test("preserves every line, showing §-codes as &", () => {
        const lines = [
            "{",
            '    id: "minecraft:stick",',
            "    Count: 1b,",
            "    tag: { display: {",
            '        Lore: ["§8Weapon", "", "§7Knock enemies into the void!"],',
            '        Name: "§6Knockback Stick"',
            "    } }",
            "}",
            "[I; 1, 2, 3]",
            "{ value: 1.0f, flag: true, name: 'single' }",
        ];
        // § only ever appears inside quoted values, so a blanket §→& swap is the
        // expected rendering of each line.
        for (const line of lines) expect(joined(line)).toBe(line.split("§").join("&"));
    });

    test("shows each §-code as & and colors the whole run", () => {
        const tokens = tokenizeSnbt('Name: "§6Starter Wand",');
        const goldRun = tokens.find((t) => t.color === GOLD);
        expect(goldRun?.text).toBe("&6Starter Wand");
        expect(tokens.some((t) => t.text.indexOf("§") >= 0)).toBe(false);
    });

    test("keeps the quotes string-colored around a colored run", () => {
        const tokens = tokenizeSnbt('"§7gray text"');
        expect(tokens[0].text).toBe('"');
        expect(tokens[tokens.length - 1].text).toBe('"');
        expect(tokens[tokens.length - 1].color).not.toBe(GRAY);
        const run = tokens.find((t) => t.color === GRAY);
        expect(run?.text).toBe("&7gray text");
    });

    test("brightens dark codes so they stay legible on the dark panel", () => {
        const run = tokenizeSnbt('"§8Weapon"').find((t) => t.text === "&8Weapon");
        expect(run).toBeDefined();
        expect(run!.color).not.toBe(DARK_GRAY);
        expect(luminance(run!.color)).toBeGreaterThan(luminance(DARK_GRAY));
    });

    test("handles back-to-back codes", () => {
        expect(joined('"§l§6Hi"')).toBe('"&l&6Hi"');
        const gold = tokenizeSnbt('"§l§6Hi"').find((t) => t.text === "&6Hi");
        expect(gold?.color).toBe(GOLD);
    });

    test("reads numeric type suffixes as one number token", () => {
        expect(tokenizeSnbt("Count: 1b,").some((t) => t.text === "1b")).toBe(true);
        expect(tokenizeSnbt("x: -1.5f").some((t) => t.text === "-1.5f")).toBe(true);
    });
});
