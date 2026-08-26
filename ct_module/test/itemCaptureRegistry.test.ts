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
