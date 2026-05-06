import type { Condition } from "htsw/types";

import TaskContext from "../../tasks/context";
import { type ItemRegistry } from "../../importables/itemRegistry";
import { waitForMenu } from "../helpers";
import { removedFormatting } from "../../utils/helpers";
import {
    parseConditionListItem,
    tryGetConditionTypeFromDisplayName,
} from "../conditionMappings";
import type { ObservedConditionSlot } from "../types";
import {
    clickPaginatedNextPage,
    getCurrentPaginatedListPageState,
    getPaginatedListSlotAtIndex,
    getVisiblePaginatedItemSlots,
    goToPaginatedListPage,
    isEmptyPaginatedPlaceholder,
} from "../paginatedList";
import { CONDITION_LIST_CONFIG } from "./listConfig";
import { isConditionListItemInverted } from "../conditions";

export async function readConditionsListPage(
    ctx: TaskContext
): Promise<ObservedConditionSlot[]> {
    return getVisiblePaginatedItemSlots(ctx)
        .filter((slot) => !isEmptyPaginatedPlaceholder(slot, CONDITION_LIST_CONFIG))
        .map((slot, index) => {
            const type = tryGetConditionTypeFromDisplayName(slot.getItem().getName());
            const observedCondition: ObservedConditionSlot = {
                index,
                slotId: slot.getSlotId(),
                slot,
                condition: null,
            };

            if (!type) {
                return observedCondition;
            }

            const condition = parseConditionListItem(slot, type);
            if (isConditionListItemInverted(slot)) {
                condition.inverted = true;
            }

            observedCondition.condition = condition;
            return observedCondition;
        });
}

export type ReadConditionListOptions = {
    itemRegistry?: ItemRegistry;
};

export async function readConditionList(
    ctx: TaskContext,
    options?: ReadConditionListOptions
): Promise<ObservedConditionSlot[]> {
    await goToPaginatedListPage(ctx, 1, CONDITION_LIST_CONFIG);
    const observed: ObservedConditionSlot[] = [];

    while (true) {
        const pageObserved = await readConditionsListPage(ctx);

        for (const entry of pageObserved) {
            entry.index = observed.length;
            observed.push(entry);
        }

        if (!getCurrentPaginatedListPageState(ctx, CONDITION_LIST_CONFIG).hasNext) {
            break;
        }

        clickPaginatedNextPage(ctx);
        await waitForMenu(ctx);
    }

    await goToPaginatedListPage(ctx, 1, CONDITION_LIST_CONFIG);
    canonicalizeObservedConditionSlots(observed, options?.itemRegistry);
    return observed;
}

function canonicalizeObservedConditionSlots(
    observed: readonly ObservedConditionSlot[],
    itemRegistry?: ItemRegistry
): void {
    if (itemRegistry === undefined) {
        return;
    }

    for (const entry of observed) {
        if (entry.condition !== null) {
            canonicalizeConditionItemName(entry.condition, itemRegistry);
        }
    }
}

export function canonicalizeObservedConditionItemNames(
    conditions: readonly (Condition | null)[],
    itemRegistry?: ItemRegistry
): void {
    if (itemRegistry === undefined) {
        return;
    }

    for (const condition of conditions) {
        if (condition !== null) {
            canonicalizeConditionItemName(condition, itemRegistry);
        }
    }
}

function canonicalizeConditionItemName(
    condition: Condition,
    itemRegistry: ItemRegistry
): void {
    if (
        condition.type !== "REQUIRE_ITEM" &&
        condition.type !== "BLOCK_TYPE" &&
        condition.type !== "IS_ITEM"
    ) {
        return;
    }

    if (condition.itemName !== undefined) {
        condition.itemName = itemRegistry.canonicalizeObservedName(condition.itemName);
    }
}
