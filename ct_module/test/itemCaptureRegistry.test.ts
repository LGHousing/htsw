import { describe, expect, test } from "vitest";

import { ItemCaptureRegistry } from "../src/importables/items/captureRegistry";
import type { ImportableItem } from "htsw/types";

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
});

describe("ItemCaptureRegistry stack counts", () => {
    const plainStone = (count?: number): string =>
        count === undefined
            ? '{id:"minecraft:stone"}'
            : `{id:"minecraft:stone",Count:${count}b}`;

    test("reads a larger stack of a declared item as a count suffix", () => {
        const registry = new ItemCaptureRegistry("shell");
        registry.seedNbtOnly("building_stone", {
            type: "compound",
            value: { id: { type: "string", value: "minecraft:stone" } },
        });

        expect(registry.register(plainStone(8), "Stone")).toBe("building_stone@8");
        expect(registry.counts()).toEqual({ matched: 1, fresh: 0 });
        expect(registry.newEntries()).toEqual([]);
    });

    test("marks the base item as captured, not the suffixed reference", () => {
        const registry = new ItemCaptureRegistry("shell");
        registry.seedNbtOnly("building_stone", {
            type: "compound",
            value: { id: { type: "string", value: "minecraft:stone" } },
        });

        registry.register(plainStone(8), "Stone");

        expect(registry.capturedItemNames()).toEqual(["building_stone"]);
        expect(registry.matchedItemNames()).toEqual(["building_stone"]);
    });

    test("collapses several stack sizes onto one declaration", () => {
        const registry = new ItemCaptureRegistry("shell");
        registry.seedNbtOnly("building_stone", {
            type: "compound",
            value: { id: { type: "string", value: "minecraft:stone" } },
        });

        expect(registry.register(plainStone(8), "Stone")).toBe("building_stone@8");
        expect(registry.register(plainStone(4), "Stone")).toBe("building_stone@4");
        expect(registry.register(plainStone(1), "Stone")).toBe("building_stone");
        expect(registry.newEntries()).toEqual([]);
    });

    test("suffixes a freshly captured item too", () => {
        const registry = new ItemCaptureRegistry("shell");

        const name = registry.register(plainStone(), "Stone");
        expect(registry.register(plainStone(16), "Stone")).toBe(`${name}@16`);
        expect(registry.newEntries()).toHaveLength(1);
    });

    test("keeps a stack larger than a suffix can express as its own item", () => {
        const registry = new ItemCaptureRegistry("shell");
        registry.seedNbtOnly("building_stone", {
            type: "compound",
            value: { id: { type: "string", value: "minecraft:stone" } },
        });

        expect(registry.register(plainStone(65), "Stone")).not.toBe(
            "building_stone@65"
        );
        expect(registry.newEntries()).toHaveLength(1);
    });

    test("does not restack onto an item whose click actions differ", () => {
        const registry = new ItemCaptureRegistry("live");
        registry.seedExportItem(item("first"), {
            kind: "cached",
            snbt: "{version:1}",
        });

        const stacked =
            '{id:"minecraft:stone",Count:8b,tag:{ExtraAttributes:{interact_data:{version:2}}}}';
        expect(registry.register(stacked, "Stone")).not.toBe("first@8");
        expect(registry.newEntries()).toHaveLength(1);
    });

    test("restacks onto the declaration whose click actions match", () => {
        const registry = new ItemCaptureRegistry("live");
        registry.seedExportItem(item("first"), {
            kind: "cached",
            snbt: "{version:1}",
        });
        registry.seedExportItem(item("second"), {
            kind: "cached",
            snbt: "{version:2}",
        });

        const stacked =
            '{id:"minecraft:stone",Count:8b,tag:{ExtraAttributes:{interact_data:{version:2}}}}';
        expect(registry.register(stacked, "Stone")).toBe("second@8");
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
