import { describe, expect, it } from "vitest";

import { BoundedLruMap, BoundedMap } from "../src/gui/lib/boundedLruMap";

describe("BoundedLruMap", () => {
    it("evicts the least recently read entry", () => {
        const cache = new BoundedLruMap<string, number>(2);
        cache.set("a", 1);
        cache.set("b", 2);

        expect(cache.get("a")).toBe(1);
        cache.set("c", 3);

        expect(cache.get("a")).toBe(1);
        expect(cache.get("b")).toBeUndefined();
        expect(cache.get("c")).toBe(3);
    });

    it("deletes only matching entries with deleteWhere", () => {
        const cache = new BoundedLruMap<string, number>(4);
        cache.set("keep-a", 1);
        cache.set("drop-a", 2);
        cache.set("drop-b", 3);
        cache.set("keep-b", 4);

        expect(
            cache.deleteWhere((key, value) => key.startsWith("drop") && value > 1)
        ).toBe(2);
        expect(cache.size).toBe(2);
        expect(cache.get("keep-a")).toBe(1);
        expect(cache.get("keep-b")).toBe(4);
        expect(cache.get("drop-a")).toBeUndefined();
        expect(cache.get("drop-b")).toBeUndefined();
    });
});

describe("BoundedMap", () => {
    it("bounds pure memo entries without promoting reads", () => {
        const cache = new BoundedMap<string, number>(2);
        cache.set("a", 1);
        cache.set("b", 2);

        expect(cache.get("a")).toBe(1);
        cache.set("c", 3);

        expect(cache.get("a")).toBeUndefined();
        expect(cache.get("b")).toBe(2);
        expect(cache.get("c")).toBe(3);
    });
});
