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

    test("treats Housing's default map icon as icon-less", () => {
        expect(importableHash(fn({ item: "minecraft:map" }))).toBe(
            importableHash(fn(undefined))
        );
        expect(importableHash(fn({ item: "minecraft:stone" }))).not.toBe(
            importableHash(fn(undefined))
        );
        expect(importableHash(fn({ item: "minecraft:map", enchanted: true }))).not.toBe(
            importableHash(fn(undefined))
        );
    });
});

describe("importableHash menu slot nbt", () => {
    test("read-back vanilla defaults hash like the source snbt", () => {
        const menu = (nbt: unknown) =>
            ({
                type: "MENU",
                name: "m",
                slots: [{ slot: 0, nbt }],
            }) as unknown as Parameters<typeof importableHash>[0];
        const source = {
            type: "compound",
            value: {
                Count: { type: "byte", value: 1 },
                id: { type: "string", value: "minecraft:stone" },
            },
        };
        const house = {
            type: "compound",
            value: {
                Count: { type: "byte", value: 1 },
                Damage: { type: "short", value: 0 },
                id: { type: "string", value: "minecraft:stone" },
                tag: {
                    type: "compound",
                    value: { display: { type: "compound", value: {} } },
                },
            },
        };
        expect(importableHash(menu(source))).toBe(importableHash(menu(house)));
        const damaged = {
            type: "compound",
            value: {
                Damage: { type: "short", value: 5 },
                id: { type: "string", value: "minecraft:stone" },
            },
        };
        expect(importableHash(menu(source))).not.toBe(importableHash(menu(damaged)));
    });
});

describe("importableHash region bounds", () => {
    test("corner pairings spanning the same box hash alike", () => {
        const region = (from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) => ({
            type: "REGION" as const,
            name: "r",
            bounds: { from, to },
        });
        expect(
            importableHash(region({ x: -3, y: 108, z: -19 }, { x: 3, y: 100, z: 0 }))
        ).toBe(
            importableHash(region({ x: -3, y: 100, z: -19 }, { x: 3, y: 108, z: 0 }))
        );
        expect(
            importableHash(region({ x: -3, y: 108, z: -19 }, { x: 3, y: 100, z: 0 }))
        ).not.toBe(
            importableHash(region({ x: -3, y: 109, z: -19 }, { x: 3, y: 100, z: 0 }))
        );
    });
});

describe("importableHash command defaults", () => {
    test("omitted settings hash like Housing's defaults", () => {
        const base = { type: "COMMAND" as const, name: "cmd", actions: [] };
        expect(
            importableHash({
                ...base,
                mode: "Self",
                requiredPriority: 0,
                listed: true,
            })
        ).toBe(importableHash(base));
        expect(
            importableHash({ ...base, mode: "Targeted", requiredPriority: 1, listed: false })
        ).not.toBe(importableHash(base));
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
