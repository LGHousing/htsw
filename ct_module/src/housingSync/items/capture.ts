import * as htsw from "htsw";

import TaskContext from "../../tasks/context";
import { getItemFromSnbt } from "../../utils/nbt";
import type { ItemFieldObservation } from "./fieldObservations";
import { clickGoBack } from "../menus/menuUtils";
import { timedWaitForMenu } from "../menus/menuWait";
import { canonicalItemShellKey, canonicalLiveItemKey, snbtFromItem } from "./itemNbt";
import {
    clearInventorySlot,
    inventoryIsFull,
    restoreInventorySlots,
    snapshotInventoryView,
    snapshotOpenContainerInventory,
    type InventorySlotSnapshot,
    type InventoryView,
} from "./playerInventory";
import { SET_SLOT_ACK_MAX_TICKS } from "../menus/packets";

const FULL_INVENTORY_CAPTURE_SLOT = 0;

export interface ItemCaptureSink {
    register(snbt: string, displayNameHint: string): string;
}

export async function captureItemFromOpenEditorField(
    ctx: TaskContext,
    fieldName: string,
    captures: ItemCaptureSink,
    displayNameHint: string
): Promise<string | null> {
    const itemFieldSlot = ctx.tryGetItemSlot(fieldName);
    if (itemFieldSlot === null) return null;

    itemFieldSlot.click();
    await timedWaitForMenu(ctx, "menuClickWait");

    let registered: string | null = null;
    try {
        const currentItemSlot = ctx.tryGetMenuItemSlot("Current Item");
        if (currentItemSlot === null) {
            ctx.displayMessage(
                `&7[item-capture] &eNo "Current Item" slot for "${displayNameHint}".`
            );
            return null;
        }

        const actionItemCount = getStackCount(currentItemSlot.getItem());
        const currentSnbt = snbtFromItem(currentItemSlot.getItem(), { pretty: false });
        const targetKey = mergeKey(currentSnbt);
        if (targetKey === null || currentSnbt === null) {
            ctx.displayMessage(
                `&7[item-capture] &eCould not read current item NBT for "${displayNameHint}".`
            );
            return null;
        }

        const inventoryView: InventoryView = "openContainer";
        const originalInventory = snapshotOpenContainerInventory();
        try {
            if (inventoryIsFull(inventoryView)) {
                await clearInventorySlot(ctx, FULL_INVENTORY_CAPTURE_SLOT, inventoryView);
            }

            const captureBaseline = snapshotOpenContainerInventory();
            currentItemSlot.click();
            const captured = await waitForCapturedInventoryChange(
                ctx,
                inventoryView,
                captureBaseline,
                targetKey,
                actionItemCount
            );
            if (captured === null) {
                ctx.displayMessage(
                    `&7[item-capture] &eNo inventory change for "${displayNameHint}".`
                );
                return null;
            }

            registered = captures.register(captured.snbt, displayNameHint);
        } finally {
            await restoreInventorySlots(ctx, originalInventory, inventoryView);
        }
    } finally {
        await clickGoBack(ctx);
    }

    return registered;
}

export async function observeItemFromOpenEditorField(
    ctx: TaskContext,
    fieldName: string,
    displayNameHint: string
): Promise<ItemFieldObservation | null> {
    const itemFieldSlot = ctx.tryGetItemSlot(fieldName);
    if (itemFieldSlot === null) return null;

    itemFieldSlot.click();
    await timedWaitForMenu(ctx, "menuClickWait");

    try {
        const currentItemSlot = ctx.tryGetMenuItemSlot("Current Item");
        if (currentItemSlot === null) {
            ctx.displayMessage(
                `&7[item-capture] &eNo "Current Item" slot for "${displayNameHint}".`
            );
            return null;
        }

        const actionItemCount = getStackCount(currentItemSlot.getItem());
        const currentSnbt = snbtFromItem(currentItemSlot.getItem(), { pretty: false });
        const targetKey = mergeKey(currentSnbt);
        if (targetKey === null || currentSnbt === null) {
            ctx.displayMessage(
                `&7[item-capture] &eCould not read current item NBT for "${displayNameHint}".`
            );
            return null;
        }

        const inventoryView: InventoryView = "openContainer";
        const originalInventory = snapshotOpenContainerInventory();
        try {
            if (inventoryIsFull(inventoryView)) {
                await clearInventorySlot(ctx, FULL_INVENTORY_CAPTURE_SLOT, inventoryView);
            }

            const captureBaseline = snapshotOpenContainerInventory();
            currentItemSlot.click();
            const captured = await waitForCapturedInventoryChange(
                ctx,
                inventoryView,
                captureBaseline,
                targetKey,
                actionItemCount
            );
            if (captured === null) {
                ctx.displayMessage(
                    `&7[item-capture] &eNo inventory change for "${displayNameHint}".`
                );
                return null;
            }

            return {
                snbt: captured.snbt,
                canonicalKey: canonicalItemShellKey(getItemFromSnbt(currentSnbt)),
            };
        } finally {
            await restoreInventorySlots(ctx, originalInventory, inventoryView);
        }
    } finally {
        await clickGoBack(ctx);
    }
}

function getStackCount(stack: unknown): number {
    if (stack === null || stack === undefined) return 0;
    const item = stack as {
        getItemStack(): HtswMinecraftItemStack | null;
        getStackSize(): number;
    };
    try {
        const count = item.getStackSize();
        if (typeof count === "number") return count;
    } catch (_error) {}
    try {
        const raw = item.getItemStack();
        if (raw !== null && typeof raw.field_77994_a === "number") {
            return raw.field_77994_a;
        }
    } catch (_error) {}
    return 0;
}

function diffForCapture(
    before: readonly InventorySlotSnapshot[],
    after: readonly InventorySlotSnapshot[],
    actionItemCount: number
): { snbt: string; slotId: number } | null {
    let found: { snbt: string; slotId: number } | null = null;
    for (let index = 0; index < before.length; index++) {
        const previous = before[index];
        const current = index < after.length ? after[index] : undefined;
        if (current === undefined || current.nbt === null) continue;
        if (current.nbt === previous.nbt && current.count === previous.count) continue;
        if (found !== null) return null;
        found = {
            snbt: rewriteSnbtCount(current.nbt, actionItemCount),
            slotId: current.slotId,
        };
    }
    return found;
}

function mergeKey(snbt: string | null): string | null {
    if (snbt === null) return null;
    try {
        return canonicalLiveItemKey(getItemFromSnbt(rewriteSnbtCount(snbt, 1)));
    } catch (_error) {
        return rewriteSnbtCount(snbt, 1);
    }
}

async function waitForCapturedInventoryChange(
    ctx: TaskContext,
    view: InventoryView,
    baseline: readonly InventorySlotSnapshot[],
    targetKey: string,
    actionItemCount: number
): Promise<{ snbt: string; slotId: number } | null> {
    for (let tick = 0; tick < SET_SLOT_ACK_MAX_TICKS; tick++) {
        const captured = capturedFromInventory(
            baseline,
            snapshotInventoryView(view),
            targetKey,
            actionItemCount
        );
        if (captured !== null) return captured;
        await ctx.waitFor("tick");
    }
    return capturedFromInventory(
        baseline,
        snapshotInventoryView(view),
        targetKey,
        actionItemCount
    );
}

function capturedFromInventory(
    baseline: readonly InventorySlotSnapshot[],
    current: readonly InventorySlotSnapshot[],
    targetKey: string,
    actionItemCount: number
): { snbt: string; slotId: number } | null {
    const changed = diffForCapture(baseline, current, actionItemCount);
    if (changed !== null) return changed;
    if (snapshotHasMatchingStack(baseline, targetKey)) return null;
    return findCapturedMatchingStack(current, targetKey, actionItemCount);
}

function snapshotHasMatchingStack(
    snapshot: readonly InventorySlotSnapshot[],
    targetKey: string
): boolean {
    for (let index = 0; index < snapshot.length; index++) {
        if (mergeKey(snapshot[index].nbt) === targetKey) return true;
    }
    return false;
}

function findCapturedMatchingStack(
    snapshot: readonly InventorySlotSnapshot[],
    targetKey: string,
    actionItemCount: number
): { snbt: string; slotId: number } | null {
    let found: { snbt: string; slotId: number } | null = null;
    for (let index = 0; index < snapshot.length; index++) {
        const entry = snapshot[index];
        if (entry.nbt === null || mergeKey(entry.nbt) !== targetKey) continue;
        if (found !== null) return null;
        found = {
            snbt: rewriteSnbtCount(entry.nbt, actionItemCount),
            slotId: entry.slotId,
        };
    }
    return found;
}

function rewriteSnbtCount(snbt: string, count: number): string {
    try {
        const tag = htsw.nbt.parseSnbtText(snbt);
        if (tag.type === "compound") {
            (tag.value as Record<string, unknown>).Count = {
                type: "byte",
                value: count,
            };
            return htsw.nbt.printSnbt(tag, { pretty: false });
        }
    } catch (_error) {}
    return snbt.replace(/(^|[{,])Count:-?\d+b/, `$1Count:${count}b`);
}
