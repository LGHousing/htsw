import TaskContext from "../tasks/context";
import { ItemSlot } from "../tasks/specifics/slots";
import { removedFormatting } from "../utils/helpers";
import { waitForMenu } from "./helpers";

const ITEMS_PER_PAGE = 21;
const PREV_PAGE_SLOT_ID = 45;
const NEXT_PAGE_SLOT_ID = 53;

export type PaginatedListConfig = {
    label: string;
    emptyPlaceholderName: string;
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
    return removedFormatting(slot.getItem().getName()).trim() === config.emptyPlaceholderName;
}

function parsePaginatedTitlePage(
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

    if (/\([^)]*\)\s*$/.test(trimmedTitle) || /^\([^)]*\)\s+/.test(trimmedTitle)) {
        throw new Error(`Malformed paginated ${config.label} title: "${title}"`);
    }

    return null;
}

function hasNextPage(ctx: TaskContext): boolean {
    return (
        ctx.tryGetItemSlot((slot) => slot.getSlotId() === NEXT_PAGE_SLOT_ID) !== null
    );
}

function hasPrevPage(ctx: TaskContext): boolean {
    return (
        ctx.tryGetItemSlot((slot) => slot.getSlotId() === PREV_PAGE_SLOT_ID) !== null
    );
}

export function getCurrentPaginatedListPageState(
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
    if (parsedTitle === null) {
        return {
            currentPage: 1,
            totalPages: hasNext ? null : 1,
            hasNext,
            hasPrev: false,
        };
    }

    return {
        currentPage: parsedTitle.currentPage,
        totalPages: parsedTitle.totalPages,
        hasNext,
        hasPrev: hasPrevPage(ctx),
    };
}

export function getPaginatedListPageForIndex(index: number): number {
    return Math.floor(index / ITEMS_PER_PAGE) + 1;
}

export function getPaginatedListLocalIndex(index: number): number {
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

    while (true) {
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
            await waitForMenu(ctx);

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
        await waitForMenu(ctx);

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
    listLength: number,
    config: PaginatedListConfig
): Promise<ItemSlot> {
    if (listLength <= 0 || index < 0 || index >= listLength) {
        throw new Error(
            `${capitalize(config.label)} index ${index} is out of bounds for list length ${listLength}.`
        );
    }

    await goToPaginatedListPage(
        ctx,
        getPaginatedListPageForIndex(index),
        config
    );
    const visibleSlots = getVisiblePaginatedItemSlots(ctx);
    const localIndex = getPaginatedListLocalIndex(index);
    const slot = visibleSlots[localIndex];
    if (!slot) {
        throw new Error(
            `Could not resolve visible ${config.label} slot ${localIndex} for global index ${index}.`
        );
    }

    return slot;
}

export function clickPaginatedNextPage(ctx: TaskContext): void {
    ctx.getItemSlot((slot) => slot.getSlotId() === NEXT_PAGE_SLOT_ID).click();
}

function capitalize(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}
