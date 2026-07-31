import * as htsw from "htsw";

import TaskContext from "../../tasks/context";
import type { ItemSlot } from "../../tasks/specifics/slots";
import { getItemFromSnbt } from "../../utils/nbt";
import type { ItemFieldObservation } from "./fieldObservations";
import { clickGoBack } from "../menus/menuUtils";
import { timedWaitForMenu } from "../menus/menuWait";
import { canonicalItemShellKey, snbtFromItem } from "./itemNbt";
import {
    clearInventorySlot,
    inventoryIsFull,
    restoreInventorySlots,
    snapshotInventoryView,
    type InventorySlotSnapshot,
    type InventoryView,
} from "./playerInventory";
import { SET_SLOT_ACK_MAX_TICKS } from "../menus/packets";

const FULL_INVENTORY_CAPTURE_SLOT = 0;

export interface ItemCaptureSink {
    register(snbt: string, displayNameHint: string): string;
}

type CapturedEditorItem = {
    editorSnbt: string;
    recapturedSnbt: string;
};

export async function captureItemFromOpenEditorField(
    ctx: TaskContext,
    fieldName: string,
    captures: ItemCaptureSink,
    displayNameHint: string
): Promise<string | null> {
    return withCapturedEditorItem(ctx, fieldName, displayNameHint, (captured) =>
        captures.register(captured.recapturedSnbt, displayNameHint)
    );
}

export async function observeItemFromOpenEditorField(
    ctx: TaskContext,
    fieldName: string,
    displayNameHint: string
): Promise<ItemFieldObservation | null> {
    return withCapturedEditorItem(ctx, fieldName, displayNameHint, (captured) => ({
        snbt: captured.recapturedSnbt,
        canonicalKey: canonicalItemShellKey(getItemFromSnbt(captured.editorSnbt)),
    }));
}

async function withCapturedEditorItem<T>(
    ctx: TaskContext,
    fieldName: string,
    displayNameHint: string,
    useCapturedItem: (captured: CapturedEditorItem) => T
): Promise<T | null> {
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
        if (readEditorItemIdentity(currentSnbt) === null) {
            ctx.displayMessage(
                `&7[item-capture] &eCould not read current item NBT for "${displayNameHint}".`
            );
            return null;
        }

        const captured = await recaptureCurrentItem(
            ctx,
            currentItemSlot,
            currentSnbt,
            actionItemCount,
            displayNameHint
        );
        if (captured === null) return null;

        return useCapturedItem({
            editorSnbt: currentSnbt,
            recapturedSnbt: captured,
        });
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

async function recaptureCurrentItem(
    ctx: TaskContext,
    currentItemSlot: ItemSlot,
    editorSnbt: string,
    actionItemCount: number,
    displayNameHint: string
): Promise<string | null> {
    const inventoryView: InventoryView = "openContainer";
    const originalInventory = snapshotInventoryView(inventoryView);
    try {
        if (inventoryIsFull(inventoryView)) {
            await clearInventorySlot(ctx, FULL_INVENTORY_CAPTURE_SLOT, inventoryView);
        }

        const captureBaseline = snapshotInventoryView(inventoryView);
        currentItemSlot.click();
        const captured = await waitForCapturedInventoryChange(
            ctx,
            inventoryView,
            captureBaseline,
            editorSnbt,
            actionItemCount
        );
        if (captured === null) {
            ctx.displayMessage(
                `&7[item-capture] &eNo inventory change for "${displayNameHint}".`
            );
        }
        return captured;
    } finally {
        await restoreInventorySlots(ctx, originalInventory, inventoryView);
    }
}

function diffForCapture(
    before: readonly InventorySlotSnapshot[],
    after: readonly InventorySlotSnapshot[],
    actionItemCount: number
): string | null {
    let normalizedNbt: string | null = null;
    for (let index = 0; index < before.length; index++) {
        const previous = before[index];
        const current = index < after.length ? after[index] : undefined;
        if (current === undefined) return null;
        if (current.nbt === previous.nbt && current.count === previous.count) continue;
        if (current.nbt === null) return null;
        const currentNormalizedNbt = rewriteSnbtCount(current.nbt, 1);
        if (normalizedNbt !== null && currentNormalizedNbt !== normalizedNbt) return null;
        normalizedNbt = currentNormalizedNbt;
    }
    return normalizedNbt === null ? null : rewriteSnbtCount(normalizedNbt, actionItemCount);
}

async function waitForCapturedInventoryChange(
    ctx: TaskContext,
    view: InventoryView,
    baseline: readonly InventorySlotSnapshot[],
    editorSnbt: string,
    actionItemCount: number
): Promise<string | null> {
    for (let tick = 0; tick < SET_SLOT_ACK_MAX_TICKS; tick++) {
        const captured = diffForCapture(baseline, snapshotInventoryView(view), actionItemCount);
        if (captured !== null && capturedMatchesEditor(captured, editorSnbt)) return captured;
        await ctx.waitFor("tick");
    }
    const captured = diffForCapture(baseline, snapshotInventoryView(view), actionItemCount);
    return captured !== null && capturedMatchesEditor(captured, editorSnbt) ? captured : null;
}

type EditorItemIdentity = {
    id: string;
    damage: string;
    interactData: string | null;
};

function readEditorItemIdentity(snbt: string): EditorItemIdentity | null {
    try {
        const root = htsw.nbt.parseSnbtText(snbt);
        if (root.type !== "compound") return null;
        const value = root.value as Partial<Record<string, htsw.nbt.Tag>>;
        const id = value.id;
        const damage = value.Damage;
        if (id === undefined || damage === undefined) return null;
        const interactData = compoundChild(compoundChild(value.tag, "ExtraAttributes"), "interact_data");
        return {
            id: htsw.nbt.printSnbt(id, { pretty: false }),
            damage: htsw.nbt.printSnbt(damage, { pretty: false }),
            interactData:
                interactData === null
                    ? null
                    : ["left", "right", "version"]
                          .map((key) => {
                              const child = interactData.value[key];
                              return child === undefined
                                  ? ""
                                  : htsw.nbt.printSnbt(child, { pretty: false });
                          })
                          .join("|"),
        };
    } catch (_error) {
        return null;
    }
}

function compoundChild(
    tag: htsw.nbt.Tag | undefined | null,
    key: string
): htsw.nbt.TagCompound | null {
    if (tag === undefined || tag === null || tag.type !== "compound") return null;
    const child = tag.value[key];
    return child !== undefined && child.type === "compound" ? child : null;
}

function capturedMatchesEditor(capturedSnbt: string, editorSnbt: string): boolean {
    const captured = readEditorItemIdentity(capturedSnbt);
    const editor = readEditorItemIdentity(editorSnbt);
    if (captured === null || editor === null) return false;
    if (captured.id !== editor.id || captured.damage !== editor.damage) return false;
    return editor.interactData === null || captured.interactData === editor.interactData;
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
