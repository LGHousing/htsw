import { describe, expect, test } from "vitest";
import { parsePaginatedTitlePage } from "../src/housingSync/menus/paginatedList";

const config = {
    label: "action",
    emptyPlaceholderName: "No actions",
};

describe("parsePaginatedTitlePage", () => {
    test("parses Housing's leading page marker", () => {
        expect(parsePaginatedTitlePage("(2/3) Actions: Loop", config)).toEqual({
            currentPage: 2,
            totalPages: 3,
        });
    });

    test("does not mistake parenthesized content names for pagination", () => {
        expect(parsePaginatedTitlePage("Actions: Fish (Tier 1)", config)).toBeNull();
        expect(parsePaginatedTitlePage("Actions: Loop (1/2 Second)", config)).toBeNull();
        expect(parsePaginatedTitlePage("Actions: Extra Misc. (1)", config)).toBeNull();
    });

    test("rejects a malformed leading page marker", () => {
        expect(() => parsePaginatedTitlePage("(x/3) Actions: Loop", config)).toThrow(
            'Malformed paginated action title: "(x/3) Actions: Loop"'
        );
    });
});
