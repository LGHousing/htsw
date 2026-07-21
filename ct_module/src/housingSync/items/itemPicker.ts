import { isUnspawnableItem } from "htsw";

import { recordRuntimeDebug } from "../../runtimeDebug/runtimeDebugBuffer";
import { summarizeItemStack } from "../../runtimeDebug/itemStackSummary";
import TaskContext from "../../tasks/context";
import { pollTicks } from "../../tasks/poll";
import { removedFormatting } from "../../utils/helpers";
import { timedWaitForMenu, waitForMenu } from "../menus/menuWait";
import { SET_SLOT_ACK_MAX_TICKS, sendCreativeInventoryAction } from "../menus/packets";
import { COST } from "../progress/costs";
import { timed } from "../progress/timing";
import { canonicalLiveItemKey } from "./itemNbt";
import {
    inventorySlotToOpenContainerSlot,
    readInventorySlot,
    restoreInventorySlots,
} from "./playerInventory";

const SCRATCH_INVENTORY_SLOT = 26;

export type StackMatcher = (left: MCItemStack, right: MCItemStack) => boolean;

export async function setItemValue(
    ctx: TaskContext,
    fieldName: string,
    item: Item,
    match: StackMatcher = canonicalStacksEqual
): Promise<void> {
    ctx.getItemSlot(fieldName).click();
    await timedWaitForMenu(ctx, "menuClickWait");
    await selectItemFromOpenInventory(ctx, item, fieldName, match);
}

export async function selectItemFromOpenInventory(
    ctx: TaskContext,
    item: Item,
    label: string,
    match: StackMatcher = canonicalStacksEqual
): Promise<void> {
    const container = Player.getContainer() as unknown as
        ReturnType<typeof Player.getContainer> | null | undefined;
    if (container === null || container === undefined) {
        throw new Error(
            `No open container for "${label}" item selection — cannot inject item.`
        );
    }

    const playerInvStart = container.getSize() - 36;
    const ninthHotbarSlot = container.getSize() - 1;
    const desiredStack = item.getItemStack() as MCItemStack | null;
    if (desiredStack === null) {
        throw new Error(`Cannot select an empty item for "${label}".`);
    }
    const desiredSummary = summarizeItemStack(desiredStack);
    recordRuntimeDebug("itemInjection", {
        stage: "selectStart",
        label,
        desired: desiredSummary,
        containerSize: container.getSize(),
    });

    const existingSlot = ctx.tryGetItemSlot((slot) => {
        if (slot.getSlotId() < playerInvStart || slot.getSlotId() === ninthHotbarSlot) {
            return false;
        }
        return match(slot.getItem().getItemStack(), desiredStack);
    });
    if (existingSlot !== null) {
        recordRuntimeDebug("itemInjection", {
            stage: "existingSlotMatched",
            label,
            slot: existingSlot.getSlotId(),
            stack: summarizeItemStack(existingSlot.getItem().getItemStack()),
        });
        existingSlot.click();
        await timed("itemSelect", COST.itemSelect, () => waitForMenu(ctx));
        return;
    }

    if (
        desiredSummary !== null &&
        desiredSummary.id !== null &&
        isUnspawnableItem(desiredSummary.id)
    ) {
        throw new Error(`Cannot creative-spawn "${desiredSummary.id}" for "${label}".`);
    }

    const targetSlotInContainer =
        inventorySlotToOpenContainerSlot(SCRATCH_INVENTORY_SLOT);
    if (targetSlotInContainer === null) {
        throw new Error(`Could not locate the player inventory for "${label}".`);
    }
    const originalScratchSlot = readInventorySlot(
        SCRATCH_INVENTORY_SLOT,
        "openContainer"
    );

    try {
        recordRuntimeDebug("itemInjection", {
            stage: "creativeSend",
            label,
            packetSlot: SCRATCH_INVENTORY_SLOT,
            targetSlot: targetSlotInContainer,
            desired: desiredSummary,
            before: summarizeItemStack(containerSlotStack(targetSlotInContainer)),
        });
        sendCreativeInventoryAction(ctx, SCRATCH_INVENTORY_SLOT, desiredStack);
        const landed = await pollTicks(ctx, SET_SLOT_ACK_MAX_TICKS, () =>
            slotMatchesStack(targetSlotInContainer, desiredStack, match)
        );
        if (!landed) {
            const itemName = removedFormatting(item.getName());
            const observed = summarizeItemStack(
                containerSlotStack(targetSlotInContainer)
            );
            recordRuntimeDebug("itemInjection", {
                stage: "creativeFailed",
                label,
                packetSlot: SCRATCH_INVENTORY_SLOT,
                targetSlot: targetSlotInContainer,
                desired: desiredSummary,
                observed,
            });
            const observedText =
                observed === null
                    ? "the target slot was empty"
                    : `the target slot held "${observed.cleanName}" (${observed.id ?? "unknown id"}:${observed.damage ?? "?"})`;
            throw new Error(
                `Couldn't place "${itemName}" for "${label}" — ${observedText} after ` +
                    `creative spawn instead of the expected item/NBT.`
            );
        }

        recordRuntimeDebug("itemInjection", {
            stage: "creativeMatched",
            label,
            packetSlot: SCRATCH_INVENTORY_SLOT,
            targetSlot: targetSlotInContainer,
            observed: summarizeItemStack(containerSlotStack(targetSlotInContainer)),
        });
        await ctx.waitFor("tick");

        const slot = ctx.tryGetItemSlot(
            (candidate) => candidate.getSlotId() === targetSlotInContainer
        );
        if (slot === null) {
            throw new Error(
                `Could not find injected item for "${label}" selection at container slot ${targetSlotInContainer}.`
            );
        }
        slot.click();
        await timed("itemSelect", COST.itemSelect, () => waitForMenu(ctx));
    } finally {
        await restoreInventorySlots(ctx, [originalScratchSlot]);
    }
}

function canonicalStacksEqual(left: MCItemStack, right: MCItemStack): boolean {
    return canonicalLiveItemKey(new Item(left)) === canonicalLiveItemKey(new Item(right));
}

function slotMatchesStack(
    slotId: number,
    stack: MCItemStack,
    match: StackMatcher
): boolean {
    const container = Player.getContainer() as unknown as
        ReturnType<typeof Player.getContainer> | null | undefined;
    const slot = container?.getItems()[slotId];
    return slot !== null && slot !== undefined && match(slot.getItemStack(), stack);
}

function containerSlotStack(slotId: number): MCItemStack | null {
    const container = Player.getContainer() as unknown as
        ReturnType<typeof Player.getContainer> | null | undefined;
    const slot = container?.getItems()[slotId];
    if (slot === null || slot === undefined) return null;
    return slot.getItemStack();
}
