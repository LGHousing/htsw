import { describe, expect, test } from "vitest";
import {
    getPaginatedListSlotAtIndex,
    parsePaginatedTitlePage,
} from "../src/housingSync/menus/paginatedList";

const config = {
    label: "action",
    emptyPlaceholderName: "No actions",
};

describe("parsePaginatedTitlePage", () => {
    test("parses Housing's leading page marker", () => {
        expect(parsePaginatedTitlePage("(2/3) Actions: Loop (wind_burst)", config)).toEqual({
            currentPage: 2,
            totalPages: 3,
        });
    });

    test("accepts one-page action titles ending in parentheses", () => {
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

test("slot lookup checks actual entries and never returns an empty-list placeholder", async () => {
    let name = "Change Variable";
    const slot = { getSlotId: () => 10, getItem: () => ({ getName: () => name }) };
    const ctx = {
        getOpenContainerTitle: () => "Edit Actions",
        tryGetItemSlot: () => null,
        getAllItemSlots: () => [slot],
    };
    await expect(getPaginatedListSlotAtIndex(ctx as never, 0, config)).resolves.toBe(
        slot
    );
    await expect(getPaginatedListSlotAtIndex(ctx as never, 1, config)).rejects.toThrow(
        "page holds 1 entries"
    );
    name = config.emptyPlaceholderName;
    await expect(getPaginatedListSlotAtIndex(ctx as never, 0, config)).rejects.toThrow(
        "page holds 0 entries"
    );
});
