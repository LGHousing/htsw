import { describe, expect, it, vi } from "vitest";

import { BoundedLruMap, BoundedMap } from "../src/gui/lib/boundedLruMap";

describe("BoundedLruMap", () => {
    it("evicts the least recently read entry", () => {
        const cache = new BoundedLruMap<string, number>(2);
        cache.set("a", 1);
        cache.set("b", 2);

        expect(cache.get("a")).toBe(1);
        cache.set("c", 3);

        expect(cache.has("a")).toBe(true);
        expect(cache.has("b")).toBe(false);
        expect(cache.has("c")).toBe(true);
    });

    it("passes the evicted key and value to the callback", () => {
        const onEvict = vi.fn();
        const cache = new BoundedLruMap<string, { id: number }>(2, onEvict);
        const first = { id: 1 };
        const second = { id: 2 };
        cache.set("first", first);
        cache.set("second", second);
        cache.get("first");

        cache.set("third", { id: 3 });

        expect(onEvict).toHaveBeenCalledOnce();
        expect(onEvict).toHaveBeenCalledWith("second", second);
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
        expect(cache.has("keep-a")).toBe(true);
        expect(cache.has("keep-b")).toBe(true);
        expect(cache.has("drop-a")).toBe(false);
        expect(cache.has("drop-b")).toBe(false);
    });

    it("does not promote entries read with peek", () => {
        const cache = new BoundedLruMap<string, number>(2);
        cache.set("a", 1);
        cache.set("b", 2);

        expect(cache.peek("a")).toBe(1);
        cache.set("c", 3);

        expect(cache.has("a")).toBe(false);
        expect(cache.has("b")).toBe(true);
    });
});

describe("BoundedMap", () => {
    it("bounds pure memo entries without promoting reads", () => {
        const cache = new BoundedMap<string, number>(2);
        cache.set("a", 1);
        cache.set("b", 2);

        expect(cache.get("a")).toBe(1);
        cache.set("c", 3);

        expect(cache.has("a")).toBe(false);
        expect(cache.has("b")).toBe(true);
        expect(cache.has("c")).toBe(true);
    });
});
