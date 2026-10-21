import { IncompleteReadError } from "../incompleteRead";
import TaskContext from "../../tasks/context";
import { ItemSlot } from "../../tasks/specifics/slots";
import { plainItemName } from "../../utils/helpers";
import { timedWaitForMenu } from "./menuWait";

const ITEMS_PER_PAGE = 21;
const PREV_PAGE_SLOT_ID = 45;
const NEXT_PAGE_SLOT_ID = 53;

export type PaginatedListConfig = {
    label: string;
    emptyPlaceholderName: string;
};

export type PaginatedListReadOptions = {
    /** Check page titles, controls and entry counts before clearing a conflict. */
    requireFullPages?: boolean;
};

export function getVisiblePaginatedItemSlots(ctx: TaskContext): ItemSlot[] {
    const slots = ctx.getAllItemSlots((slot) => {
        const slotId = slot.getSlotId();
        const row = Math.floor(slotId / 9);
        const col = slotId % 9;
        return row >= 1 && row <= 3 && col >= 1 && col <= 7;
    });
    if (slots === null) {
        throw new Error("No open container found");
    }
    return slots.sort((a, b) => a.getSlotId() - b.getSlotId());
}

export function isEmptyPaginatedPlaceholder(
    slot: ItemSlot,
    config: PaginatedListConfig
): boolean {
    const rawItem: unknown = slot.getItem();
    const item = rawItem as Item | null | undefined;
    if (item === null || item === undefined) return false;
    const actual = plainItemName(item.getName());
    const expected = config.emptyPlaceholderName.trim();
    return actual.toLowerCase() === expected.toLowerCase();
}

/**
 * An entry's name from its list slot, or null for the list's own controls
 * (Go Back, Close, the Create button, page arrows).
 */
export function paginatedEntryName(displayName: string, createLabel: string): string | null {
    const name = plainItemName(displayName);
    if (name.length === 0) return null;
    const lower = name.toLowerCase();
    if (
        lower === "go back" ||
        lower === "close" ||
        lower === createLabel.toLowerCase() ||
        lower.indexOf("previous page") >= 0 ||
        lower.indexOf("next page") >= 0
    ) {
        return null;
    }
    return name;
}

// Not confirmed in-game: the menu and region lists may show a trailing numeric
// note such as "(12 slots)"; drop it, keeping names with other parentheses.
export function withoutNumericNote(name: string): string {
    const m = name.match(/^(.+?)\s*\(\d[^)]*\)$/);
    return m !== null ? m[1] : name;
}

export function parsePaginatedTitlePage(
    title: string,
    config: PaginatedListConfig
): { currentPage: number; totalPages: number } | null {
    const trimmedTitle = title.trim();
    const exactMatch = trimmedTitle.match(/^\((\d+)\/(\d+)\)\s+/);
    if (exactMatch) {
        const currentPage = Number(exactMatch[1]);
        const totalPages = Number(exactMatch[2]);
        if (
            !Number.isInteger(currentPage) ||
            !Number.isInteger(totalPages) ||
            currentPage < 1 ||
            totalPages < 1 ||
            currentPage > totalPages
        ) {
            throw new Error(`Invalid paginated ${config.label} title: "${title}"`);
        }
        return { currentPage, totalPages };
    }

    if (/^\([^)]*\)\s+/.test(trimmedTitle)) {
        throw new Error(`Malformed paginated ${config.label} title: "${title}"`);
    }

    return null;
}

function hasNextPage(ctx: TaskContext): boolean {
    return ctx.tryGetItemSlot((slot) => slot.getSlotId() === NEXT_PAGE_SLOT_ID) !== null;
}

function hasPrevPage(ctx: TaskContext): boolean {
    return ctx.tryGetItemSlot((slot) => slot.getSlotId() === PREV_PAGE_SLOT_ID) !== null;
}

function getCurrentPaginatedListPageState(
    ctx: TaskContext,
    config: PaginatedListConfig
): {
    currentPage: number;
    totalPages: number | null;
    hasNext: boolean;
    hasPrev: boolean;
} {
    const title = ctx.getOpenContainerTitle();
    if (title === null) {
        throw new Error("No open container found");
    }

    const parsedTitle = parsePaginatedTitlePage(title, config);
    const hasNext = hasNextPage(ctx);
    const hasPrev = hasPrevPage(ctx);
    if (parsedTitle === null) {
        return {
            currentPage: 1,
            totalPages: null,
            hasNext,
            hasPrev,
        };
    }

    return {
        currentPage: parsedTitle.currentPage,
        totalPages: parsedTitle.totalPages,
        hasNext,
        hasPrev,
    };
}

export function getPaginatedListPageForIndex(index: number): number {
    return Math.floor(index / ITEMS_PER_PAGE) + 1;
}

function getPaginatedListLocalIndex(index: number): number {
    return index % ITEMS_PER_PAGE;
}

export async function goToPaginatedListPage(
    ctx: TaskContext,
    targetPage: number,
    config: PaginatedListConfig
): Promise<void> {
    if (!Number.isInteger(targetPage) || targetPage < 1) {
        throw new Error(`Invalid target ${config.label} page: ${targetPage}`);
    }

    for (;;) {
        const state = getCurrentPaginatedListPageState(ctx, config);
        if (state.currentPage === targetPage) {
            return;
        }

        if (state.currentPage < targetPage) {
            if (!state.hasNext) {
                throw new Error(
                    `Cannot move to ${config.label} page ${targetPage}; no next page from ${state.currentPage}.`
                );
            }

            ctx.getItemSlot((slot) => slot.getSlotId() === NEXT_PAGE_SLOT_ID).click();
            await timedWaitForMenu(ctx, "pageTurnWait");

            const nextState = getCurrentPaginatedListPageState(ctx, config);
            if (nextState.currentPage <= state.currentPage) {
                throw new Error(
                    `${capitalize(config.label)} page did not advance after clicking next page.`
                );
            }
            continue;
        }

        if (!state.hasPrev) {
            throw new Error(
                `Cannot move to ${config.label} page ${targetPage}; no previous page from ${state.currentPage}.`
            );
        }

        ctx.getItemSlot((slot) => slot.getSlotId() === PREV_PAGE_SLOT_ID).click();
        await timedWaitForMenu(ctx, "pageTurnWait");

        const prevState = getCurrentPaginatedListPageState(ctx, config);
        if (prevState.currentPage >= state.currentPage) {
            throw new Error(
                `${capitalize(config.label)} page did not go back after clicking previous page.`
            );
        }
    }
}

export async function getPaginatedListSlotAtIndex(
    ctx: TaskContext,
    index: number,
    config: PaginatedListConfig
): Promise<ItemSlot> {
    if (!Number.isInteger(index) || index < 0) {
        throw new Error(`Invalid ${config.label} index: ${index}.`);
    }

    await goToPaginatedListPage(ctx, getPaginatedListPageForIndex(index), config);
    const visibleSlots = getVisiblePaginatedItemSlots(ctx).filter(
        (slot) => !isEmptyPaginatedPlaceholder(slot, config)
    );
    const localIndex = getPaginatedListLocalIndex(index);
    if (localIndex >= visibleSlots.length) {
        throw new Error(
            `Could not resolve visible ${config.label} slot ${localIndex} for global index ${index} (page holds ${visibleSlots.length} entries).`
        );
    }

    return visibleSlots[localIndex];
}

export async function findPaginatedListEntry<T extends { index: number }>(
    ctx: TaskContext,
    config: PaginatedListConfig,
    readPage: () => Promise<T[]>,
    matches: (entry: T) => boolean,
    onPageRead?: (entries: readonly T[]) => void
): Promise<{ entry: T; slot: ItemSlot } | null> {
    await goToPaginatedListPage(ctx, 1, config);

    let totalEntries = 0;
    for (;;) {
        const visibleSlots = getVisiblePaginatedItemSlots(ctx);
        const pageEntries = await readPage();
        const localSlotIndices: number[] = [];
        for (let i = 0; i < pageEntries.length; i++) {
            localSlotIndices[i] = pageEntries[i].index;
            pageEntries[i].index = totalEntries + i;
        }
        onPageRead?.(pageEntries);

        for (let i = 0; i < pageEntries.length; i++) {
            const localSlotIndex = localSlotIndices[i];
            if (!matches(pageEntries[i])) continue;

            if (localSlotIndex < 0 || localSlotIndex >= visibleSlots.length) {
                throw new Error(
                    `Could not resolve visible ${config.label} slot ${localSlotIndex}.`
                );
            }
            const slot = visibleSlots[localSlotIndex];
            return { entry: pageEntries[i], slot };
        }

        totalEntries += pageEntries.length;
        const stateBefore = getCurrentPaginatedListPageState(ctx, config);
        if (!stateBefore.hasNext) break;

        clickPaginatedNextPage(ctx);
        await timedWaitForMenu(ctx, "pageTurnWait");

        const stateAfter = getCurrentPaginatedListPageState(ctx, config);
        if (stateAfter.currentPage <= stateBefore.currentPage) {
            throw new Error(
                `Paginated ${config.label} page did not advance after clicking next page (still on page ${stateAfter.currentPage}).`
            );
        }
    }

    return null;
}

function clickPaginatedNextPage(ctx: TaskContext): void {
    ctx.getItemSlot((slot) => slot.getSlotId() === NEXT_PAGE_SLOT_ID).click();
}

/**
 * Read every page of a Housing paginated list and concatenate. Navigates to
 * page 1 at the start and leaves the GUI on the last page it read. Every
 * caller re-navigates to the page it needs before touching the menu, so a
 * trailing reset here would just be page turns nobody depends on. Renumbers
 * `entry.index` across pages so it matches the global list position.
 *
 * `onPageRead` fires once per page after entries are merged; use it for
 * progress reporting. `pagesRead` starts at 1.
 */
export async function readPaginatedList<T extends { index: number }>(
    ctx: TaskContext,
    config: PaginatedListConfig,
    readPage: () => Promise<T[]>,
    onPageRead?: (state: {
        totalEntries: number;
        pagesRead: number;
        entries: readonly T[];
    }) => void,
    { requireFullPages = false }: PaginatedListReadOptions = {}
): Promise<T[]> {
    await goToPaginatedListPage(ctx, 1, config);
    const entries: T[] = [];
    let totalPages: number | null = null;
    let pagesRead = 0;
    const requireCompletePage = () => {
        const state = getCurrentPaginatedListPageState(ctx, config);
        // Housing can omit the first page's marker even when Next is present.
        // Learn the total from a numbered page, if one is encountered.
        if (totalPages === null) totalPages = state.totalPages;
        if (
            (state.totalPages !== null && state.totalPages !== totalPages) ||
            state.currentPage !== pagesRead + 1 ||
            state.hasPrev !== state.currentPage > 1 ||
            (totalPages !== null && state.hasNext !== state.currentPage < totalPages)
        ) {
            throw new IncompleteReadError(
                `Incomplete paginated ${config.label} list: expected page ${pagesRead + 1}/${totalPages}, found ${state.currentPage}/${state.totalPages} (previous: ${state.hasPrev}, next: ${state.hasNext}).`
            );
        }
    };
    for (;;) {
        if (requireFullPages) requireCompletePage();
        const pageEntries = await readPage();
        if (requireFullPages) {
            requireCompletePage();
            const isFinalPage = !hasNextPage(ctx);
            // A multi-page list must end with 1..ITEMS_PER_PAGE entries.
            // This cannot detect a partially rendered final page; conflict
            // clearing also compares the full read's count and summaries
            // with the initial scan.
            const minEntries = isFinalPage ? (pagesRead === 0 ? 0 : 1) : ITEMS_PER_PAGE;
            if (pageEntries.length < minEntries || pageEntries.length > ITEMS_PER_PAGE) {
                throw new IncompleteReadError(
                    `Incomplete paginated ${config.label} list: page ${pagesRead + 1}/${totalPages} has ${pageEntries.length} entries; expected ${minEntries}..${ITEMS_PER_PAGE}.`
                );
            }
        }
        for (const entry of pageEntries) {
            entry.index = entries.length;
            entries.push(entry);
        }
        pagesRead++;
        onPageRead?.({ totalEntries: entries.length, pagesRead, entries });
        const stateBefore = getCurrentPaginatedListPageState(ctx, config);
        if (!stateBefore.hasNext) break;

        clickPaginatedNextPage(ctx);
        await timedWaitForMenu(ctx, "pageTurnWait");

        // Conflict reads check the exact next page at the top of the loop.
        // Ordinary reads retain their original forward-progress guard.
        const stateAfter = getCurrentPaginatedListPageState(ctx, config);
        if (!requireFullPages && stateAfter.currentPage <= stateBefore.currentPage) {
            throw new Error(
                `Paginated ${config.label} page did not advance after clicking next page (still on page ${stateAfter.currentPage}).`
            );
        }
    }
    return entries;
}

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}
