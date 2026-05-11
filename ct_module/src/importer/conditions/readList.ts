import type { Condition } from "htsw/types";

import TaskContext from "../../tasks/context";
import { type ItemRegistry } from "../../importables/itemRegistry";
import { canonicalizeItemFields } from "../canonicalizeItems";
import {
    CONDITION_MAPPINGS,
    parseConditionListItem,
    tryGetConditionTypeFromDisplayName,
} from "../conditionMappings";
import type { ObservedConditionSlot } from "../types";
import {
    getVisiblePaginatedItemSlots,
    isEmptyPaginatedPlaceholder,
    readPaginatedList,
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
    const observed = await readPaginatedList(
        ctx,
        CONDITION_LIST_CONFIG,
        () => readConditionsListPage(ctx)
    );
    canonicalizeObservedConditionSlots(observed, options?.itemRegistry);
    return observed;
}

function canonicalizeObservedConditionSlots(
    observed: readonly ObservedConditionSlot[],
    itemRegistry?: ItemRegistry
): void {
    if (itemRegistry === undefined) return;
    for (const entry of observed) {
        if (entry.condition !== null) {
            canonicalizeItemFields(entry.condition, CONDITION_MAPPINGS, itemRegistry);
        }
    }
}

export function canonicalizeObservedConditionItemNames(
    conditions: readonly (Condition | null)[],
    itemRegistry?: ItemRegistry
): void {
    if (itemRegistry === undefined) return;
    for (const condition of conditions) {
        if (condition !== null) {
            canonicalizeItemFields(condition, CONDITION_MAPPINGS, itemRegistry);
        }
    }
}
