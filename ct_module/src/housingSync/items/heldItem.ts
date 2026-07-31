import TaskContext from "../../tasks/context";
import { pollTicks } from "../../tasks/poll";
import { summarizeItemStack } from "../../runtimeDebug/itemStackSummary";
import { closeOpenScreen } from "../sideEffects";
import {
    SET_SLOT_ACK_MAX_TICKS,
    selectedHotbarSlot,
    sendCreativeInventoryAction,
} from "../menus/packets";
import {
    clearInventorySlot,
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

            try {
                await clearInventorySlot(ctx, 0, "player");
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
        if (held.slot.nbt !== null) {
            await clearInventorySlot(ctx, slotId, "player");
        }
        await injectIntoHotbarSlot(ctx, slotId, stack);
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

async function injectIntoHotbarSlot(
    ctx: TaskContext,
    slotId: number,
    stack: MCItemStack
): Promise<void> {
    sendCreativeInventoryAction(ctx, inventorySlotToPacketSlot(slotId), stack);
    if (!(await waitForStack(ctx, slotId, stack))) {
        const observed = Player.getInventory()?.getStackInSlot(slotId)?.getItemStack();
        throw new Error(
            `Hypixel did not accept this item into your hotbar. Check that its SNBT is formatted correctly ` +
                `(slot ${slotId} holds: ${JSON.stringify(summarizeItemStack(observed))}).`
        );
    }
    await ctx.waitFor("tick");
}

async function placeInHotbarSlot(
    ctx: TaskContext,
    slotId: number,
    stack: MCItemStack
): Promise<void> {
    await injectIntoHotbarSlot(ctx, slotId, stack);
    await selectHotbarSlotAndWait(ctx, slotId);
}

async function waitForStack(
    ctx: TaskContext,
    slotId: number,
    expected: MCItemStack
): Promise<boolean> {
    return pollTicks(ctx, SET_SLOT_ACK_MAX_TICKS, () => {
        const current = Player.getInventory()?.getStackInSlot(slotId)?.getItemStack() as
            MCItemStack | null | undefined;
        return (
            current !== null && current !== undefined && stacksMatch(current, expected)
        );
    });
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

