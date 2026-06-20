import { describe, it, expect } from "vitest";

import { matchByHash } from "../src/gui/code-view/actionMatch";

describe("matchByHash", () => {
    it("returns all-null when there is no cache baseline", () => {
        expect(matchByHash(["a", "b"], undefined)).toEqual([null, null]);
        expect(matchByHash(["a", "b"], [])).toEqual([null, null]);
    });

    it("maps an unchanged list one-to-one", () => {
        expect(matchByHash(["a", "b", "c"], ["a", "b", "c"])).toEqual([0, 1, 2]);
    });

    it("treats an insertion at the top as a single add, shifting the rest", () => {
        // The reported bug: adding one action must not cascade. Only the new
        // action is unmatched; everything else maps to its (shifted) slot.
        expect(matchByHash(["new", "a", "b", "c"], ["a", "b", "c"])).toEqual([
            null,
            0,
            1,
            2,
        ]);
    });

    it("treats an insertion in the middle as a single add", () => {
        expect(matchByHash(["a", "new", "b"], ["a", "b"])).toEqual([0, null, 1]);
    });

    it("treats an append as a single add", () => {
        expect(matchByHash(["a", "b"], ["a"])).toEqual([0, null]);
    });

    it("pairs an edit in place with its old slot (so it reads as edit, not add)", () => {
        // "B" replaces "b"; it still pairs with slot 1 — the caller compares
        // hashes there and reports "edit".
        expect(matchByHash(["a", "B", "c"], ["a", "b", "c"])).toEqual([0, 1, 2]);
    });

    it("skips a deleted slot without disturbing the survivors", () => {
        expect(matchByHash(["a", "c"], ["a", "b", "c"])).toEqual([0, 2]);
    });

    it("handles an insertion that shifts a later block (the CONDITIONAL case)", () => {
        // Mirrors the screenshot: one action inserted before a block that was
        // unchanged. The block must still map to its cache slots, not all-add.
        expect(
            matchByHash(["new", "a", "b", "c", "d"], ["a", "b", "c", "d"])
        ).toEqual([null, 0, 1, 2, 3]);
    });
});
