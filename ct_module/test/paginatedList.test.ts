import { describe, expect, it, test, vi } from "vitest";
import {
    getPaginatedListSlotAtIndex,
    parsePaginatedTitlePage,
    readPaginatedList,
} from "../src/housingSync/menus/paginatedList";

vi.mock("../src/housingSync/menus/menuWait", () => ({
    timedWaitForMenu: vi.fn(async () => undefined),
}));

const config = {
    label: "action",
    emptyPlaceholderName: "No actions",
};

describe("parsePaginatedTitlePage", () => {
    test("parses Housing's leading page marker", () => {
        expect(
            parsePaginatedTitlePage("(2/3) Actions: Loop (wind_burst)", config)
        ).toEqual({
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

// Conflict re-reads require page titles, controls and entry counts to agree.
describe("readPaginatedList", () => {
    const page = (
        current: number,
        total = 3,
        next = current < total,
        prev = current > 1
    ) => ({
        title: `(${current}/${total}) Actions`,
        next,
        prev,
    });
    function context(pages: readonly { title: string; next: boolean; prev: boolean }[]) {
        let index = 0;
        const ctx = {
            getOpenContainerTitle: () => pages[index].title,
            tryGetItemSlot: (matches: (slot: { getSlotId: () => number }) => boolean) => {
                const controls = [
                    ...(pages[index].next
                        ? [
                              {
                                  getSlotId: () => 53,
                                  click: () => {
                                      index++;
                                  },
                              },
                          ]
                        : []),
                    ...(pages[index].prev
                        ? [
                              {
                                  getSlotId: () => 45,
                                  click: () => {
                                      index--;
                                  },
                              },
                          ]
                        : []),
                ];
                return controls.find(matches) ?? null;
            },
            getItemSlot: (matches: (slot: { getSlotId: () => number }) => boolean) =>
                ctx.tryGetItemSlot(matches)!,
        };
        return ctx;
    }

    it.each([
        ["missing Next", [page(1, 2, false)]],
        ["Next on the last page", [page(1, 1, true)]],
        ["Previous on the first page", [page(1, 2, true, true)]],
        ["missing Previous", [page(1, 2), page(2, 2, false, false)]],
        ["skipped page", [page(1), page(3)]],
        ["unchanged page", [page(1), page(1)]],
        ["changed total", [page(1, 2), page(2, 3)]],
        ["lost page marker", [page(1, 2), { title: "Actions", next: false, prev: true }]],
    ] as const)("rejects inconsistent conflict pages: %s", async (_label, pages) => {
        const ctx = context(pages);
        await expect(
            readPaginatedList(
                ctx as never,
                config,
                async () => Array.from({ length: 21 }, (_, index) => ({ index })),
                undefined,
                { requireFullPages: true }
            )
        ).rejects.toThrow("Incomplete paginated action list");
    });

    it.each([false, true])(
        "reads an unnumbered Functions first page with Next (conflict checks: %s)",
        async (requireFullPages) => {
            const ctx = context([
                { title: "Functions", next: true, prev: false },
                { title: "(2/2) Functions", next: false, prev: true },
            ]);
            let current = 0;
            const entries = await readPaginatedList(
                ctx as never,
                { label: "function", emptyPlaceholderName: "No items!" },
                async () =>
                    Array.from({ length: ++current === 1 ? 21 : 2 }, (_, index) => ({
                        index,
                        page: current,
                    })),
                undefined,
                { requireFullPages }
            );
            expect(entries).toEqual(
                Array.from({ length: 23 }, (_, index) => ({
                    index,
                    page: index < 21 ? 1 : 2,
                }))
            );
        }
    );

    it("ordinary reads follow controls even when numbered totals disagree", async () => {
        const ctx = context([page(1, 1, true), page(2, 3, false)]);
        await expect(
            readPaginatedList(ctx as never, config, async () => [{ index: 0 }])
        ).resolves.toEqual([{ index: 0 }, { index: 1 }]);
    });

    it("ordinary reads reject a page that does not advance", async () => {
        const ctx = context([page(1, 2), page(1, 2)]);
        await expect(
            readPaginatedList(ctx as never, config, async () => [{ index: 0 }])
        ).rejects.toThrow("page did not advance");
    });
});
