import { describe, expect, test } from "vitest";

import { cyrb53 } from "../src/utils/helpers";

// These exact values were produced by ChatTriggers' Rhino (ctjs 2.2.1,
// optimization level 9 — the in-game engine) and are the form persisted in
// every knowledge cache and house.lock.json. cyrb53 must keep returning them
// in every environment; a "fix" back to standard cyrb53 (`h1 >>> 0`) would
// silently invalidate all stored hashes whose low word has the sign bit set.
describe("cyrb53 matches the in-game persisted form", () => {
    test("inputs where the low word is negative as int32", () => {
        expect(cyrb53("a")).toBe(0x1c2ba682c97901);
        expect(cyrb53("hello world")).toBe(0xb9416d15d1014);
        expect(cyrb53("probe2")).toBe(0x1ee00bfb2c37a2);
    });

    test("inputs where the low word is non-negative", () => {
        expect(cyrb53("probe0")).toBe(0x18e4190abe8e03);
        expect(cyrb53("probe1")).toBe(0x1716323e8a2c10);
    });
});
