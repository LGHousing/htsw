import TaskContext from "../../tasks/context";
import { pollTicks } from "../../tasks/poll";
import { getItemFromSnbt } from "../../utils/nbt";
import {
    SET_SLOT_ACK_MAX_TICKS,
    SET_SLOT_ACK_TIMEOUT_MS,
    selectHotbarSlot,
    selectedHotbarSlot,
    sendCreativeInventoryAction,
    waitForAnySetSlot,
} from "../menus/packets";
import { traceNote } from "../trace/taskTrace";
import { snbtFromItem } from "./itemNbt";

const INVENTORY_SIZE = 36;

export type InventoryView = "player" | "openContainer";

export type InventorySlotSnapshot = {
    slotId: number;
    nbt: string | null;
    count: number;
};

export type PlayerInventorySnapshot = {
    slots: InventorySlotSnapshot[];
    selectedHotbarSlot: number;
};

export function snapshotPlayerInventory(): PlayerInventorySnapshot {
    return {
        slots: snapshotInventoryView("player"),
        selectedHotbarSlot: selectedHotbarSlot(),
    };
}

export function snapshotOpenContainerInventory(): InventorySlotSnapshot[] {
    return snapshotInventoryView("openContainer");
}

export function snapshotInventoryView(view: InventoryView): InventorySlotSnapshot[] {
    const snapshot: InventorySlotSnapshot[] = [];
    for (let slotId = 0; slotId < INVENTORY_SIZE; slotId++) {
        snapshot.push(readInventorySlot(slotId, view));
    }
    return snapshot;
}

export function inventoryIsFull(view: InventoryView): boolean {
    for (let slotId = 0; slotId < INVENTORY_SIZE; slotId++) {
        if (readInventorySlot(slotId, view).nbt === null) return false;
    }
    return true;
}

export function inventorySlotToPacketSlot(slotId: number): number {
    return slotId < 9 ? 36 + slotId : slotId;
}

export function inventorySlotToOpenContainerSlot(slotId: number): number | null {
    const container = Player.getContainer() as unknown as
        ReturnType<typeof Player.getContainer> | null | undefined;
    if (container === null || container === undefined) return null;
    const size = container.getSize();
    if (size < INVENTORY_SIZE) return null;
    if (slotId < 9) return size - 9 + slotId;
    return size - INVENTORY_SIZE + (slotId - 9);
}

export function readInventorySlot(
    slotId: number,
    view: InventoryView
): InventorySlotSnapshot {
    if (view === "openContainer") {
        const containerSlot = inventorySlotToOpenContainerSlot(slotId);
        if (containerSlot !== null) {
            const container = Player.getContainer() as unknown as
                ReturnType<typeof Player.getContainer> | null | undefined;
            if (container !== null && container !== undefined) {
                const items = container.getItems() as unknown as Array<
                    Item | null | undefined
                >;
                if (containerSlot >= 0 && containerSlot < items.length) {
                    return entryFromItem(slotId, items[containerSlot]);
                }
            }
        }
    }
    return entryFromItem(slotId, Player.getInventory()?.getStackInSlot(slotId));
}

async function waitForInventorySlotMatch(
    ctx: TaskContext,
    view: InventoryView,
    expected: InventorySlotSnapshot
): Promise<boolean> {
    return pollTicks(
        ctx,
        SET_SLOT_ACK_MAX_TICKS,
        () => inventorySlotMatches(readInventorySlot(expected.slotId, view), expected),
        { stableTicks: 2 }
    );
}

async function waitForSetSlotAck(ctx: TaskContext, label: string): Promise<void> {
    try {
        await ctx.withTimeout(waitForAnySetSlot(ctx), label, SET_SLOT_ACK_TIMEOUT_MS);
    } catch (error) {
        traceNote("player-inventory", `${label} timeout: ${String(error)}`);
    }
}

export async function clearInventorySlot(
    ctx: TaskContext,
    slotId: number,
    view: InventoryView
): Promise<void> {
    sendCreativeInventoryAction(ctx, inventorySlotToPacketSlot(slotId), null);
    await waitForSetSlotAck(ctx, `clear inventory slot ${slotId}`);
    const cleared = await waitForInventorySlotMatch(ctx, view, {
        slotId,
        nbt: null,
        count: 0,
    });
    if (!cleared) {
        throw new Error(`Inventory slot ${slotId} did not clear.`);
    }
}

export async function restoreInventorySlots(
    ctx: TaskContext,
    snapshot: readonly InventorySlotSnapshot[],
    view: InventoryView = "player"
): Promise<void> {
    const failures: string[] = [];
    for (let index = 0; index < snapshot.length; index++) {
        const entry = snapshot[index];
        if (inventorySlotMatches(readInventorySlot(entry.slotId, view), entry)) continue;

        let desiredStack: HtswMinecraftItemStack | null = null;
        if (entry.nbt !== null) {
            try {
                desiredStack = getItemFromSnbt(entry.nbt).getItemStack();
            } catch (error) {
                failures.push(
                    `slot ${entry.slotId}: could not rebuild item (${String(error)})`
                );
                continue;
            }
        }

        sendCreativeInventoryAction(
            ctx,
            inventorySlotToPacketSlot(entry.slotId),
            desiredStack
        );
        await waitForSetSlotAck(ctx, `restore inventory slot ${entry.slotId}`);
        if (!(await waitForInventorySlotMatch(ctx, view, entry))) {
            failures.push(
                `slot ${entry.slotId}: server did not accept the restored item`
            );
        }
    }
    if (failures.length > 0) {
        throw new Error(`Inventory restore failed: ${failures.join("; ")}`);
    }
}

export async function restorePlayerInventory(
    ctx: TaskContext,
    snapshot: PlayerInventorySnapshot
): Promise<void> {
    try {
        await restoreInventorySlots(ctx, snapshot.slots);
    } finally {
        await selectHotbarSlotAndWait(ctx, snapshot.selectedHotbarSlot);
    }
}

export async function selectHotbarSlotAndWait(
    ctx: TaskContext,
    slotId: number
): Promise<void> {
    if (selectedHotbarSlot() === slotId) return;
    selectHotbarSlot(ctx, slotId);
    await ctx.waitFor("tick");
}

function inventorySlotMatches(
    current: InventorySlotSnapshot,
    expected: InventorySlotSnapshot
): boolean {
    return current.nbt === expected.nbt && current.count === expected.count;
}

function entryFromItem(
    slotId: number,
    stack: Item | null | undefined
): InventorySlotSnapshot {
    if (stack === null || stack === undefined) return { slotId, nbt: null, count: 0 };
    return {
        slotId,
        nbt: snbtFromItem(stack, { pretty: false }),
        count: getStackCount(stack),
    };
}

function getStackCount(stack: Item): number {
    try {
        const count = stack.getStackSize();
        if (typeof count === "number") return count;
    } catch (_error) {}
    try {
        const raw = stack.getItemStack();
        if (typeof raw.field_77994_a === "number") {
            return raw.field_77994_a;
        }
    } catch (_error) {}
    return 0;
}
