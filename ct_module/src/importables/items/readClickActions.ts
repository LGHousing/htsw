import type { Action } from "htsw/types";

import { hydrateActionListScan } from "../../housingSync/actions/hydration/run";
import { scanActionList } from "../../housingSync/actions/readList";
import type { ListReadOptions } from "../../housingSync/context/actionReadContext";
import { shallowActionListHasActions } from "../../housingSync/fields/loreParsing";
import {
    temporarilyHoldItem,
    restoreTemporarilyHeldItem,
} from "../../housingSync/items/heldItem";
import { canonicalLiveItemKey } from "../../housingSync/items/itemNbt";
import { heldItem } from "../../housingSync/items/playerInventory";
import { clickGoBack } from "../../housingSync/menus/menuUtils";
import { chatMessage, menuOpened } from "../../housingSync/menus/menuWaiters";
import { fullyHydratedObservedSlotsToActions } from "../../housingSync/observedActions";
import type { SyncEventHandler } from "../../housingSync/syncEvents";
import type TaskContext from "../../tasks/context";
import { oneOf } from "../../tasks/waiters";
import { itemEditorOpened } from "../waiters";

export async function readClickActions(
    ctx: TaskContext,
    item: Item,
    read: ListReadOptions,
    eventsForList?: (label: string) => SyncEventHandler
): Promise<{ left: Action[]; right: Action[] }> {
    const expected = canonicalLiveItemKey(item);
    const assertHeldItem = (): void => {
        const current = heldItem();
        if (current === null || canonicalLiveItemKey(current) !== expected) {
            throw new Error("The item changed while its click actions were being read.");
        }
    };
    const held = await temporarilyHoldItem(ctx, item);
    try {
        // Creative acceptance alone does not prove the item survived a house
        // loop. Never read the actions of whatever replaced it in our hand.
        assertHeldItem();
        const opened = await ctx.expectAfter(
            () => ctx.runCommand("/edit"),
            oneOf({
                opened: itemEditorOpened(),
                refused: chatMessage("You can't edit that item!"),
            })
        );
        if (opened === "refused") {
            throw new Error(
                "Housing refused /edit for the held item: You can't edit that item! Its click actions are unreadable."
            );
        }
        assertHeldItem();
        await ctx.expectAfter(
            () => ctx.getItemSlot("Edit Actions").click(),
            menuOpened({
                kind: "menuClickWait",
                label: "Waiting for item click actions",
                items: ["Left Click Actions", "Right Click Actions"],
            })
        );

        const result: { left: Action[]; right: Action[] } = { left: [], right: [] };
        for (const side of ["left", "right"] as const) {
            const label = side === "left" ? "Left Click Actions" : "Right Click Actions";
            const slot = ctx.getItemSlot(label);
            // Only an explicit Actions: - None is known empty. Unrecognized
            // summary lore falls through to the full action-list reader.
            if (!shallowActionListHasActions(slot)) continue;
            await ctx.expectAfter(
                () => slot.click(),
                menuOpened({
                    kind: "menuClickWait",
                    label: `Waiting for ${label}`,
                    items: ["Add Action"],
                })
            );
            const listRead = { ...read, events: eventsForList?.(label) ?? read.events };
            const scan = await scanActionList(ctx, { kind: "full" }, listRead);
            await hydrateActionListScan(ctx, scan, listRead);
            // Reject unknown nodes and missing child lists instead of using
            // the general export conversion, which can omit unread entries.
            result[side] = fullyHydratedObservedSlotsToActions(scan.slots);
            await clickGoBack(ctx);
        }
        assertHeldItem();
        return result;
    } finally {
        await restoreTemporarilyHeldItem(ctx, held);
    }
}
