import { describe, expect, test } from "vitest";
import * as htsw from "htsw";

import { ItemCaptureRegistry } from "../src/importables/items/captureRegistry";
import { MINECRAFT_ITEMS, type ImportableItem } from "htsw/types";

const first = '{id:"minecraft:stone",tag:{ExtraAttributes:{interact_data:{version:1}}}}';
const second = '{id:"minecraft:stone",tag:{ExtraAttributes:{interact_data:{version:2}}}}';
const item = (name: string): ImportableItem => ({
    type: "ITEM",
    name,
    nbt: {
        type: "compound",
        value: {
            id: { type: "string", value: "minecraft:stone" },
        },
    },
    leftClickActions: [],
});

describe("ItemCaptureRegistry identity", () => {
    test("keeps same-shell items with different click actions separate", () => {
        const registry = new ItemCaptureRegistry("live");

        const firstName = registry.register(first, "Stone");
        const secondName = registry.register(second, "Stone");

        expect(secondName).not.toBe(firstName);
        expect(registry.newEntries()).toHaveLength(2);
    });

    test("deduplicates the same live item", () => {
        const registry = new ItemCaptureRegistry("live");

        expect(registry.register(first, "Stone")).toBe(
            registry.register(first, "Stone Again")
        );
        expect(registry.newEntries()).toHaveLength(1);
    });

    test("portable shell registries ignore Housing click data", () => {
        const registry = new ItemCaptureRegistry("shell");

        expect(registry.register(first, "Stone")).toBe(
            registry.register(second, "Stone")
        );
        expect(registry.newEntries()).toHaveLength(1);
    });

    test("matches same-shell declarations by their cached click actions", () => {
        const registry = new ItemCaptureRegistry("live");
        registry.seedExportItem(item("first"), {
            kind: "cached",
            snbt: "{version:1}",
        });
        registry.seedExportItem(item("second"), {
            kind: "cached",
            snbt: "{version:2}",
        });

        expect(registry.register(first, "Stone")).toBe("first");
        expect(registry.register(second, "Stone")).toBe("second");
        expect(registry.counts()).toEqual({ matched: 2, fresh: 0 });
    });

    test("reuses the first declaration when cached click-action identities are equal", () => {
        const registry = new ItemCaptureRegistry("live");
        registry.seedExportItem(item("first"), {
            kind: "cached",
            snbt: "{version:1}",
        });
        registry.seedExportItem(item("second"), {
            kind: "cached",
            snbt: "{version:1}",
        });

        expect(registry.register(first, "Stone")).toBe("first");
        expect(registry.counts()).toEqual({ matched: 1, fresh: 0 });
    });

    test("suffixes a name when an on-disk file has different canonical NBT", () => {
        const registry = new ItemCaptureRegistry("shell", {
            existingSnbt: (name) =>
                name === "tribes"
                    ? '{id:"minecraft:stone",tag:{custom:2b}}'
                    : null,
        });

        expect(registry.register(first, "Tribes")).toBe("tribes_2");
    });

    test("reuses an on-disk name with identical canonical NBT and deduplicates it", () => {
        const registry = new ItemCaptureRegistry("shell", {
            existingSnbt: (name) =>
                name === "tribes"
                    ? '{tag:{ExtraAttributes:{interact_data:{version:2}}},id:"minecraft:stone"}'
                    : null,
        });

        expect(registry.register(first, "Tribes")).toBe("tribes");
        expect(registry.register(second, "TRIBES")).toBe("tribes");
        expect(registry.newEntries()).toHaveLength(1);
    });

    test("names unnamed items from their vanilla id and damage variation", () => {
        const greenPane = MINECRAFT_ITEMS.find(
            (entry) => entry.name === "stained_glass_pane"
        )?.variations?.find((entry) => entry.metadata === 13);
        expect(greenPane).toBeDefined();
        expect(
            htsw.items.vanillaVariationReferenceName(greenPane?.displayName ?? "")
        ).toBe("green_stained_glass_pane");

        const registry = new ItemCaptureRegistry("shell");
        expect(
            registry.register(
                '{id:"minecraft:stained_glass_pane",Count:1b,Damage:13s}',
                ""
            )
        ).toBe("green_stained_glass_pane");
        expect(
            registry.register('{id:"minecraft:skull",Count:1b,Damage:0s}', "")
        ).toBe("skull");
    });
});

describe("ItemCaptureRegistry block references", () => {
    test("uses a vanilla id for a new default block payload", () => {
        const registry = new ItemCaptureRegistry("live");

        expect(
            registry.registerBlockReference(
                '{id:"minecraft:stone",Count:1b,Damage:0s,tag:{display:{}}}',
                "Stone"
            )
        ).toBe("minecraft:stone");
        expect(registry.newEntries()).toEqual([]);
    });

    test("keeps the project name for an existing default block item", () => {
        const registry = new ItemCaptureRegistry("live");
        registry.seedNbtOnly("building_stone", {
            type: "compound",
            value: {
                id: { type: "string", value: "minecraft:stone" },
            },
        });

        expect(
            registry.registerBlockReference(
                '{id:"minecraft:stone",Count:1b,Damage:0s}',
                "Stone"
            )
        ).toBe("building_stone");
        expect(registry.counts()).toEqual({ matched: 1, fresh: 0 });
    });

    test.each([
        ["damage metadata", '{id:"minecraft:stone",Count:1b,Damage:1s}', "Damage:1s"],
        [
            "display metadata",
            '{id:"minecraft:stone",Count:1b,Damage:0s,tag:{display:{Name:"Custom Stone"}}}',
            'Name:"Custom Stone"',
        ],
        [
            "Housing click metadata",
            '{id:"minecraft:stone",Count:1b,Damage:0s,tag:{ExtraAttributes:{interact_data:{version:1}}}}',
            "interact_data",
        ],
        [
            "other custom metadata",
            '{id:"minecraft:stone",Count:1b,Damage:0s,tag:{custom:{}}}',
            "custom:{}",
        ],
    ])("captures %s without discarding it", (_label, snbt, expectedMetadata) => {
        const registry = new ItemCaptureRegistry("live");

        const name = registry.registerBlockReference(snbt, "Stone");

        expect(name).toBe("stone");
        expect(registry.newEntries()).toHaveLength(1);
        expect(registry.newEntries()[0].snbt).toContain(expectedMetadata);
    });
});
