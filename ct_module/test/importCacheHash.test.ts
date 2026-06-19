import { describe, expect, test } from "vitest";
import type { ImportableFunction } from "htsw/types";

import type { ImportableCacheEntry } from "../src/importCache/cache";
import { importableHash, listHashes } from "../src/importCache/hash";
import { cacheEntryListHashes } from "../src/importCache/status";

function fn(icon: ImportableFunction["icon"]): ImportableFunction {
    return {
        type: "FUNCTION",
        name: "Glint Test",
        icon,
    };
}

describe("importableHash function icons", () => {
    test("includes enchant glint", () => {
        expect(importableHash(fn({ item: "minecraft:map" }))).not.toBe(
            importableHash(fn({ item: "minecraft:map", enchanted: true }))
        );
    });

    test("ignores default count and unset glint", () => {
        expect(importableHash(fn({ item: "minecraft:map", count: 1, enchanted: false }))).toBe(
            importableHash(fn({ item: "minecraft:map" }))
        );
    });
});

describe("cache entry hashes", () => {
    test("recomputes list hashes from the cached importable", () => {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name: "Sound Test",
            actions: [
                {
                    type: "PLAY_SOUND",
                    sound: "random.orb",
                    volume: 0.7,
                    pitch: 1,
                    location: {
                        type: "Custom Coordinates",
                        value: "~ ~ ~",
                        coordinates: {
                            x: { kind: "relative", value: "0" },
                            y: { kind: "relative", value: "0" },
                            z: { kind: "relative", value: "0" },
                            yaw: undefined,
                            pitch: undefined,
                        },
                    },
                },
            ],
        };
        const entry = {
            schemaVersion: 2,
            writtenAt: "2026-06-19T00:00:00.000Z",
            writer: "importer",
            importable,
            hash: "old",
            lists: { actions: ["old"] },
        } as ImportableCacheEntry;

        expect(cacheEntryListHashes(entry)).toEqual(listHashes(importable));
        expect(cacheEntryListHashes(entry).actions).not.toEqual(entry.lists.actions);
    });
});
