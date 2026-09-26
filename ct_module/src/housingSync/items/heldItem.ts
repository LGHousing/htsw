import TaskContext from "../../tasks/context";
import { pollTicks } from "../../tasks/poll";
import { getOpenContainerWindowId } from "../../tasks/specifics/slots";
import { summarizeItemStack } from "../../runtimeDebug/itemStackSummary";
import { closeOpenScreen } from "../sideEffects";
import {
    SET_SLOT_ACK_MAX_TICKS,
    selectedHotbarSlot,
    sendCreativeInventoryAction,
    waitForSetSlotAck,
} from "../menus/packets";
import {
    heldItem,
    inventorySlotToOpenContainerSlot,
    inventorySlotToPacketSlot,
    readInventorySlot,
    restoreInventorySlots,
    selectHotbarSlotAndWait,
    type InventorySlotSnapshot,
} from "./playerInventory";

type BorrowedHotbarSlot = {
    slot: InventorySlotSnapshot;
    selectedHotbarSlot: number;
};

export type ImportedItemPlacementSession = {
    place(ctx: TaskContext, item: Item): Promise<void>;
    restore(ctx: TaskContext): Promise<void>;
};

export function createImportedItemPlacementSession(): ImportedItemPlacementSession {
    let borrowed: BorrowedHotbarSlot | null = null;

    return {
        async place(ctx: TaskContext, item: Item): Promise<void> {
            const stack = item.getItemStack() as MCItemStack | null;
            if (stack === null) throw new Error("Cannot inject an empty item stack.");

            await closeOpenScreen(ctx);
            const emptySlot = findEmptyHotbarSlot();
            if (emptySlot !== undefined) {
                await placeInHotbarSlot(ctx, emptySlot, stack);
                return;
            }

            if (borrowed === null) {
                borrowed = {
                    slot: readInventorySlot(0, "player"),
                    selectedHotbarSlot: selectedHotbarSlot(),
                };
                ctx.displayMessage(
                    "&e[import] Hotbar full — temporarily using the first hotbar slot during this import."
                );
            }

            // No clear first: a creative set replaces the slot outright, and a
            // clear that must stay empty aborts whenever the server refills it.
            try {
                await placeInHotbarSlot(ctx, 0, stack);
            } catch (error) {
                await restoreBorrowedSlot(ctx, borrowed);
                borrowed = null;
                throw error;
            }
        },

        async restore(ctx: TaskContext): Promise<void> {
            if (borrowed === null) return;
            const slot = borrowed;
            borrowed = null;
            await closeOpenScreen(ctx);
            await restoreBorrowedSlot(ctx, slot);
        },
    };
}

export type TemporarilyHeldItem = {
    slot: InventorySlotSnapshot;
    selectedHotbarSlot: number;
};

export async function temporarilyHoldItem(
    ctx: TaskContext,
    item: Item
): Promise<TemporarilyHeldItem> {
    const stack = item.getItemStack() as MCItemStack | null;
    if (stack === null) throw new Error("Cannot inject an empty item stack.");

    await closeOpenScreen(ctx);
    const slotId = findEmptyHotbarSlot() ?? 0;
    const held = {
        slot: readInventorySlot(slotId, "player"),
        selectedHotbarSlot: selectedHotbarSlot(),
    };
    try {
        await injectIntoInventorySlot(ctx, slotId, stack);
        await selectHotbarSlotAndWait(ctx, slotId);
        return held;
    } catch (error) {
        await restoreTemporarilyHeldItem(ctx, held);
        throw error;
    }
}

export async function restoreTemporarilyHeldItem(
    ctx: TaskContext,
    held: TemporarilyHeldItem
): Promise<void> {
    await closeOpenScreen(ctx);
    try {
        await restoreInventorySlots(ctx, [held.slot]);
    } finally {
        await selectHotbarSlotAndWait(ctx, held.selectedHotbarSlot);
    }
}

function findEmptyHotbarSlot(): number | undefined {
    for (let slotId = 0; slotId < 9; slotId++) {
        if (readInventorySlot(slotId, "player").nbt === null) return slotId;
    }
    return undefined;
}

/**
 * Creative-set `stack` into inventory slot `slotId` (0-8 hotbar, 9-35 main)
 * and wait for Hypixel to confirm it. The S2FPacketSetSlot ack counts as
 * acceptance whatever the slot holds afterwards: a house loop or event can
 * swap the item out within the same tick, which an inventory poll alone
 * would misreport as rejected SNBT.
 */
export async function injectIntoInventorySlot(
    ctx: TaskContext,
    slotId: number,
    stack: MCItemStack
): Promise<void> {
    const packetSlot = inventorySlotToPacketSlot(slotId);
    // With no container open the server echoes on window 0 at the packet
    // slot. An open container (a Housing menu, the inventory) covers the
    // player inventory too, so the echo comes on its window at its slot index.
    const containerSlot = inventorySlotToOpenContainerSlot(slotId);
    const containerWindowId = getOpenContainerWindowId();
    // Latched inside the predicate, which runs as the packet arrives; the
    // promise itself is only held so the waiter can be cleaned up.
    let acked = false;
    const ack = waitForSetSlotAck(ctx, (windowId, slot, received) => {
        if (received === null || !stacksMatch(received, stack)) return false;
        const forThisSlot =
            (windowId === 0 && slot === packetSlot) ||
            (containerSlot !== null &&
                windowId === containerWindowId &&
                slot === containerSlot);
        if (!forThisSlot) return false;
        acked = true;
        return true;
    });
    ack.catch(() => {});
    let accepted: boolean;
    try {
        sendCreativeInventoryAction(ctx, packetSlot, stack);
        accepted = await pollTicks(
            ctx,
            SET_SLOT_ACK_MAX_TICKS,
            () => acked || slotHolds(slotId, stack)
        );
    } finally {
        ack.cleanupWaiter?.();
    }
    if (!accepted) {
        throw new Error(describeRejectedStack(slotId));
    }
    await ctx.waitFor("tick");
}

function describeRejectedStack(slotId: number): string {
    const observed = Player.getInventory()?.getStackInSlot(slotId)?.getItemStack() as
        MCItemStack | null | undefined;
    const holds = JSON.stringify(summarizeItemStack(observed));
    if (observed !== null && observed !== undefined) {
        return (
            `Hypixel never confirmed this item in your inventory, and slot ${slotId} now holds ${holds}. ` +
                `Either something in the house (a loop or event reacting to the item) replaced it, ` +
                `or the SNBT was rejected.`
        );
    }
    return (
        `Hypixel did not accept this item into your inventory. Check that its SNBT is formatted correctly ` +
            `(slot ${slotId} holds: ${holds}).`
    );
}

/**
 * The placed item must still be in hand before `/edit`. Editing whatever the
 * house swapped in would attach the click actions to the wrong item.
 */
export function assertHeldStackIs(item: Item, label: string): void {
    const expected = item.getItemStack() as MCItemStack | null;
    const current = heldItem()?.getItemStack() as MCItemStack | null | undefined;
    if (
        expected !== null &&
        current !== null &&
        current !== undefined &&
        stacksMatch(current, expected)
    ) {
        return;
    }
    throw new Error(
        `The house replaced '${label}' in your hotbar before it could be edited ` +
            `(slot ${selectedHotbarSlot()} now holds ${JSON.stringify(summarizeItemStack(current))}). ` +
            `A loop or event in the house reacts to this item; pause it and retry.`
    );
}

async function placeInHotbarSlot(
    ctx: TaskContext,
    slotId: number,
    stack: MCItemStack
): Promise<void> {
    await injectIntoInventorySlot(ctx, slotId, stack);
    await selectHotbarSlotAndWait(ctx, slotId);
}

function slotHolds(slotId: number, expected: MCItemStack): boolean {
    const current = Player.getInventory()?.getStackInSlot(slotId)?.getItemStack() as
        MCItemStack | null | undefined;
    return current !== null && current !== undefined && stacksMatch(current, expected);
}

function stacksMatch(current: MCItemStack, expected: MCItemStack): boolean {
    return (
        current.func_77973_b() === expected.func_77973_b() &&
        current.func_77960_j() === expected.func_77960_j() &&
        current.field_77994_a === expected.field_77994_a &&
        String(current.func_82833_r()) === String(expected.func_82833_r())
    );
}

async function restoreBorrowedSlot(
    ctx: TaskContext,
    borrowed: BorrowedHotbarSlot
): Promise<void> {
    try {
        await restoreInventorySlots(ctx, [borrowed.slot]);
    } finally {
        await selectHotbarSlotAndWait(ctx, borrowed.selectedHotbarSlot);
    }
}

