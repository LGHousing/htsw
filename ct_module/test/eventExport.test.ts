import { describe, expect, it } from "vitest";

import { shouldIncludeEventInExport } from "../src/importables/events/readHouseEvents";

describe("event exports", () => {
    it("excludes events with no actions", () => {
        expect(shouldIncludeEventInExport([])).toBe(false);
    });

    it("includes events with actions", () => {
        expect(
            shouldIncludeEventInExport([
                { type: "MESSAGE", message: '"hello"' },
            ])
        ).toBe(true);
    });
});
