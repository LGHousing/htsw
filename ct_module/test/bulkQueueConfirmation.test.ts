import { describe, expect, it } from "vitest";

import { bulkQueueConfirmation } from "../src/gui/left-panel/houses/bulkQueueConfirmation";

describe("bulk queue confirmation", () => {
    it("explains that Read all refreshes live names and ignores filters", () => {
        const copy = bulkQueueConfirmation("read", "Functions", "project/import.json");

        expect(copy.title).toBe("Queue Read All Functions?");
        expect(copy.lines.join(" ")).toContain("refresh current-house names");
        expect(copy.lines.join(" ")).toContain("regardless of search or filters");
        expect(copy.danger).toBe(false);
    });

    it("warns that Export all can replace local edits", () => {
        const copy = bulkQueueConfirmation("export", "Menus", "project/import.json");

        expect(copy.title).toBe("Queue Export All Menus?");
        expect(copy.lines.join(" ")).toContain("replace local versions");
        expect(copy.lines.join(" ")).toContain("project/import.json");
        expect(copy.danger).toBe(true);
    });
});
