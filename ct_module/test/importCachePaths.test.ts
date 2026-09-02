import { describe, expect, it } from "vitest";

import { cyrb53 } from "../src/utils/helpers";
import {
    cachePathForId,
    legacyCachePathForId,
} from "../src/importCache/paths";

describe("import cache paths", () => {
    it("keeps case-sensitive identities distinct on case-insensitive filesystems", () => {
        const lower = cachePathForId("house", "ITEM", "cobblestone");
        const upper = cachePathForId("house", "ITEM", "Cobblestone");

        expect(lower).not.toBe(upper);
        expect(lower.toLowerCase()).not.toBe(upper.toLowerCase());
        expect(lower).toContain(`~${cyrb53("cobblestone").toString(16)}`);
        expect(lower.endsWith(".knowledge.json")).toBe(true);
        expect(legacyCachePathForId("house", "ITEM", "cobblestone")).toBe(
            "./htsw/.cache/house/item/cobblestone.knowledge.json"
        );
    });
});
