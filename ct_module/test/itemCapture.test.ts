import { describe, expect, test } from "vitest";

import {
    itemInteractDataMatches,
    normalizeItemSnbtForExport,
    portableItemSnbt,
    prettySnbt,
} from "../src/housingSync/itemCapture";

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

    test("portable item SNBT removes Housing interact_data", () => {
        const out = portableItemSnbt(
            '{id:"minecraft:stone",tag:{ExtraAttributes:{interact_data:{actions:1b},keep:"yes"}}}'
        );

        expect(out).not.toContain("interact_data");
        expect(out).toContain('keep: "yes"');
    });
});

describe("cached item click actions", () => {
    const live =
        '{id:"minecraft:stone",tag:{ExtraAttributes:{interact_data:{version:1,actions:[{type:"chat"}]}}}}';

    test("recognizes an interact_data blob already stored in the cache", () => {
        expect(
            itemInteractDataMatches(live, {
                kind: "cached",
                snbt: '{actions:[{type:"chat"}],version:1}',
            })
        ).toBe(true);
    });

    test("rejects a changed or unknown interact_data blob", () => {
        expect(
            itemInteractDataMatches(live, {
                kind: "cached",
                snbt: '{version:1,actions:[{type:"sound"}]}',
            })
        ).toBe(false);
        expect(itemInteractDataMatches(live, { kind: "uncached" })).toBe(false);
    });

    test("recognizes an item that still has no click actions", () => {
        expect(
            itemInteractDataMatches('{id:"minecraft:stone"}', { kind: "absent" })
        ).toBe(true);
        expect(itemInteractDataMatches(live, { kind: "absent" })).toBe(false);
    });
});
