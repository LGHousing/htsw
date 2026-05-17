import type { Condition } from "htsw/types";

import TaskContext from "../tasks/context";
import { clickGoBack, timedWaitForMenu } from "./helpers";
import { CONDITION_LIST_CONFIG } from "./conditions/listConfig";
import {
    getPaginatedListPageForIndex,
    getPaginatedListSlotAtIndex,
    goToPaginatedListPage,
} from "./paginatedList";
import {
    captureItemFromOpenActionField,
    type ItemCaptureRegistry,
} from "./itemCapture";
import type { ObservedConditionSlot } from "./types";

/**
 * All item-bearing conditions use the same lore label for their item
 * field in the Housing GUI. Mirrors how actions look up "Item" through
 * `getActionFieldLabel(type, "itemName")`; we hardcode here because the
 * generic constraint on `getConditionFieldLabel` doesn't accept a
 * dynamic union of condition types narrowed at runtime.
 */
const CONDITION_ITEM_FIELD_LABEL = "Item";

/**
 * Condition types that carry an `itemName` field driven by a Housing
 * "Item" slot in the editor. We don't read these from a spec table
 * because the set is small and stable; if it grows, add the new type
 * here.
 */
const ITEM_BEARING_CONDITION_TYPES: readonly Condition["type"][] = [
    "REQUIRE_ITEM",
    "IS_ITEM",
    "BLOCK_TYPE",
];

function isItemBearingCondition(type: Condition["type"]): boolean {
    for (let i = 0; i < ITEM_BEARING_CONDITION_TYPES.length; i++) {
        if (ITEM_BEARING_CONDITION_TYPES[i] === type) return true;
    }
    return false;
}

/**
 * Post-pass over an already-read condition list: for each item-bearing
 * condition, navigate into its editor, capture the real housing-tagged
 * NBT from the "Item" field, and overwrite `condition.itemName` with the
 * registered canonical name.
 *
 * Preconditions: the condition list editor (the paginated grid showing
 * all conditions) is currently open. After this returns, the same
 * condition list is still open and on page 1.
 *
 * Skips conditions whose lore parse failed (`observed.condition === null`)
 * and conditions that aren't item-bearing.
 */
export async function captureItemsForObservedConditions(
    ctx: TaskContext,
    observed: readonly ObservedConditionSlot[],
    registry: ItemCaptureRegistry
): Promise<void> {
    const listLength = observed.length;
    for (const entry of observed) {
        const condition = entry.condition;
        if (condition === null) continue;
        if (!isItemBearingCondition(condition.type)) continue;

        const fieldLabel = CONDITION_ITEM_FIELD_LABEL;
        const displayNameHint =
            typeof (condition as Record<string, unknown>).itemName === "string"
                ? ((condition as Record<string, unknown>).itemName as string)
                : condition.type;

        try {
            await goToPaginatedListPage(
                ctx,
                getPaginatedListPageForIndex(entry.index),
                CONDITION_LIST_CONFIG
            );
            const slot = await getPaginatedListSlotAtIndex(
                ctx,
                entry.index,
                listLength,
                CONDITION_LIST_CONFIG
            );
            slot.click();
            await timedWaitForMenu(ctx, "menuClickWait");

            try {
                const captured = await captureItemFromOpenActionField(
                    ctx,
                    fieldLabel,
                    registry,
                    displayNameHint
                );
                if (captured !== null) {
                    (condition as Record<string, unknown>).itemName = captured;
                }
            } finally {
                await clickGoBack(ctx);
            }
        } catch (error) {
            ctx.displayMessage(
                `&7[item-capture] &cFailed to capture item for ${condition.type} at index ${entry.index}: ${error}`
            );
            if (ctx.tryGetMenuItemSlot("Go Back") !== null) {
                await clickGoBack(ctx);
            }
        }
    }

    await goToPaginatedListPage(ctx, 1, CONDITION_LIST_CONFIG);
}
