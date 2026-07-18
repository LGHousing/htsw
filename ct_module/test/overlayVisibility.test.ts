import { describe, expect, test } from "vitest";

import { canShowHousingFrame } from "../src/gui/overlayVisibility";

describe("Housing overlay visibility", () => {
    test("shows a cold command-driven Housing task", () => {
        expect(canShowHousingFrame("unknown", true)).toBe(true);
    });

    test("keeps an idle unconfirmed container hidden", () => {
        expect(canShowHousingFrame("unknown", false)).toBe(false);
    });

    test("shows a running task despite a stale out verdict", () => {
        expect(canShowHousingFrame("out", true)).toBe(true);
    });

    test("shows confirmed Housing containers while idle", () => {
        expect(canShowHousingFrame("in", false)).toBe(true);
    });
});
