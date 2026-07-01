import { describe, expect, test } from "vitest";

import { normalizeItemSnbtForExport, prettySnbt } from "../src/housingSync/itemCapture";

describe("item SNBT export normalization", () => {
    test("uses one representation for blank lore separators", () => {
        const out = normalizeItemSnbtForExport(
            '{id:"minecraft:leather_boots",Count:1b,tag:{display:{Lore:["\u00a78Armour","","\u00a7a\u00a7lON ARMOUR","\u00a77","\u00a7f\u00a7lCOMMON"],Name:"\u00a77[\u00a7aI\u00a77] \u00a7fStarter Boots"}},Damage:0s}'
        );

        expect(out).toContain(
            'Lore:["\u00a78Armour","\u00a77","\u00a7a\u00a7lON ARMOUR","\u00a77","\u00a7f\u00a7lCOMMON"]'
        );
    });

    test("leaves malformed SNBT untouched", () => {
        expect(normalizeItemSnbtForExport("{not valid")).toBe("{not valid");
    });

    test("pretty printing uses the same lore separator representation", () => {
        const out = prettySnbt(
            '{id:"minecraft:stone",Count:1b,tag:{display:{Lore:["","\u00a77"]}}}'
        );

        expect(out).toContain('"\u00a77"');
        expect(out).not.toContain('""');
    });
});
