import TaskContext from "../../tasks/context";
import { pollTicks } from "../../tasks/poll";
import { summarizeItemStack } from "../../runtimeDebug/itemStackSummary";
import { closeOpenScreen } from "../sideEffects";
import {
    SET_SLOT_ACK_MAX_TICKS,
    selectedHotbarSlot,
    sendCreativeInventoryAction,
} from "../menus/packets";
import { COST } from "../progress/costs";
import { timed } from "../progress/timing";
import {
    clearInventorySlot,
    inventorySlotToPacketSlot,
    readInventorySlot,
    restoreInventorySlots,
    selectHotbarSlotAndWait,
    type InventorySlotSnapshot,
} from "./playerInventory";

export type ImportedItemPlacement = {
    borrowed: {
        slot: InventorySlotSnapshot;
        selectedHotbarSlot: number;
    } | null;
};

export type TemporarilyHeldItem = {
    slot: InventorySlotSnapshot;
    selectedHotbarSlot: number;
};

export async function placeImportedItem(
    ctx: TaskContext,
    item: Item
): Promise<ImportedItemPlacement> {
    const stack = item.getItemStack() as MCItemStack | null;
    if (stack === null) throw new Error("Cannot inject an empty item stack.");

    await closeOpenScreen(ctx);
    const emptySlot = findEmptyHotbarSlot();
    if (emptySlot !== undefined) {
        await injectIntoHotbarSlot(ctx, emptySlot, stack);
        await selectHotbarSlotAndWait(ctx, emptySlot);
        await waitForHeldItem(ctx);
        return { borrowed: null };
    }

    const borrowed = {
        slot: readInventorySlot(0, "player"),
        selectedHotbarSlot: selectedHotbarSlot(),
    };
    ctx.displayMessage(
        `&e[import] Hotbar full — temporarily using the first hotbar slot for ${item.getName()}.`
    );
    try {
        await clearInventorySlot(ctx, 0, "player");
        await injectIntoHotbarSlot(ctx, 0, stack);
        await selectHotbarSlotAndWait(ctx, 0);
        await waitForHeldItem(ctx);
        return { borrowed };
    } catch (error) {
        await restoreBorrowedSlot(ctx, borrowed);
        throw error;
    }
}

export async function restoreImportedItemPlacement(
    ctx: TaskContext,
    placement: ImportedItemPlacement
): Promise<void> {
    if (placement.borrowed === null) return;
    await closeOpenScreen(ctx);
    await restoreBorrowedSlot(ctx, placement.borrowed);
}

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
        await waitForHeldItem(ctx);
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
    borrowed: NonNullable<ImportedItemPlacement["borrowed"]>
): Promise<void> {
    try {
        await restoreInventorySlots(ctx, [borrowed.slot]);
    } finally {
        await selectHotbarSlotAndWait(ctx, borrowed.selectedHotbarSlot);
    }
}

async function waitForHeldItem(ctx: TaskContext): Promise<void> {
    await timed("sleep1000", COST.guaranteedSleep1000, () => ctx.sleep(1000));
}
