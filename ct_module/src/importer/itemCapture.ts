import * as htsw from "htsw";
import type { Condition } from "htsw/types";

import TaskContext from "../tasks/context";
import { canonicalSlug } from "../exporter/paths";
import { getItemFromSnbt, itemToHtswTag } from "../utils/nbt";
import { cyrb53, removedFormatting } from "../utils/helpers";
import { clickGoBack } from "./gui/helpers";
import { timedWaitForMenu } from "./gui/menuWait";
import {
    SET_SLOT_ACK_TIMEOUT_MS,
    sendCreativeInventoryAction,
    waitForAnySetSlot,
} from "./gui/packets";
import { CONDITION_LIST_CONFIG } from "./conditions/listConfig";
import { IMPORT_DEBUG } from "./diagnostics/importDebug";
import {
    getPaginatedListPageForIndex,
    getPaginatedListSlotAtIndex,
    goToPaginatedListPage,
} from "./gui/paginatedList";
import type { ObservedConditionSlot } from "./types";

const SCRATCH_PACKET_SLOT = 26;
const INVENTORY_SIZE = 36;

type InventorySnapshotEntry = {
    slotId: number;
    nbt: string | null;
    count: number;
};
export type InventorySnapshot = InventorySnapshotEntry[];
export type CapturedItem = { name: string; snbt: string; displayName: string };

export class ItemCaptureRegistry {
    private byHash: Record<string, CapturedItem> = Object.create(null);
    private nameToHash: Record<string, string> = Object.create(null);

    register(snbt: string, displayNameHint: string): string {
        const hash = nbtHash(snbt);
        const existing = this.byHash[hash];
        if (existing !== undefined) return existing.name;

        const preferred = slugForDisplayName(displayNameHint);
        let name = preferred;
        let suffix = 2;
        while (this.nameToHash[name] !== undefined && suffix < 1000) {
            name = `${preferred}_${suffix}`;
            suffix++;
        }

        this.byHash[hash] = { name, snbt, displayName: displayNameHint };
        this.nameToHash[name] = hash;
        return name;
    }

    entries(): CapturedItem[] {
        const out: CapturedItem[] = [];
        for (const hash in this.byHash) {
            out.push(this.byHash[hash]);
        }
        return out;
    }

    size(): number {
        let n = 0;
        for (const _ in this.byHash) n++;
        return n;
    }
}

function nbtHash(snbt: string): string {
    return String(cyrb53(snbt));
}

function slugForDisplayName(displayName: string): string {
    const stripped = removedFormatting(displayName).trim().toLowerCase();
    if (stripped.length === 0) return "captured_item";
    const slug = canonicalSlug(stripped);
    return slug.length > 0 ? slug : "captured_item";
}

function getStackCount(stack: any): number {
    if (stack === null || stack === undefined) return 0;
    try {
        const n = stack.getStackSize();
        if (typeof n === "number") return n;
    } catch (_e) {}
    try {
        const raw = stack.getItemStack();
        if (raw !== null && raw !== undefined) {
            const field = raw.field_77994_a;
            if (typeof field === "number") return field;
        }
    } catch (_e) {}
    return 0;
}

export function snapshotInventory(): InventorySnapshot {
    const inv = Player.getInventory();
    const snapshot: InventorySnapshot = [];
    if (inv === null || inv === undefined) return snapshot;
    for (let i = 0; i < INVENTORY_SIZE; i++) {
        const stack = inv.getStackInSlot(i);
        if (stack === null || stack === undefined) {
            snapshot.push({ slotId: i, nbt: null, count: 0 });
            continue;
        }
        const canonical = snbtFromItem(stack, { pretty: false });
        snapshot.push({
            slotId: i,
            nbt: canonical,
            count: getStackCount(stack),
        });
    }
    return snapshot;
}

function isInventoryFull(): boolean {
    const inv = Player.getInventory();
    if (inv === null || inv === undefined) return false;
    for (let i = 0; i < INVENTORY_SIZE; i++) {
        const stack = inv.getStackInSlot(i);
        if (stack === null || stack === undefined) return false;
    }
    return true;
}

function diffForCapture(
    before: InventorySnapshot,
    after: InventorySnapshot,
    actionItemCount: number
): { snbt: string } | null {
    let found: { snbt: string } | null = null;
    for (let i = 0; i < before.length; i++) {
        const b = before[i];
        const a = after[i];
        if (a === undefined) continue;
        if (a.nbt === null) continue;
        if (a.nbt === b.nbt && a.count === b.count) continue;
        if (found !== null) return null;
        found = { snbt: rewriteSnbtCount(a.nbt, actionItemCount) };
    }
    return found;
}

function rewriteSnbtCount(snbt: string, newCount: number): string {
    try {
        const tag = htsw.nbt.parseSnbtText(snbt);
        if (tag.type === "compound") {
            (tag.value as Record<string, unknown>).Count = {
                type: "byte",
                value: newCount,
            };
            return htsw.nbt.printSnbt(tag, { pretty: false });
        }
    } catch (_error) {}
    return snbt.replace(/(^|[{,])Count:-?\d+b/, `$1Count:${newCount}b`);
}

export function prettySnbt(snbt: string): string {
    try {
        const tag = htsw.nbt.parseSnbtText(snbt);
        return htsw.nbt.printSnbt(tag, { pretty: true });
    } catch (_error) {
        return snbt;
    }
}

function snbtFromItem(item: Item, opts: { pretty: boolean }): string | null {
    const tag = itemToHtswTag(item);
    if (tag === null) return null;
    return htsw.nbt.printSnbt(tag, { pretty: opts.pretty });
}

export async function captureItemFromOpenEditorField(
    ctx: TaskContext,
    fieldName: string,
    registry: ItemCaptureRegistry,
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

        if (isInventoryFull()) {
            sendCreativeInventoryAction(
                ctx,
                SCRATCH_PACKET_SLOT,
                null,
            );
            try {
                await ctx.withTimeout(
                    waitForAnySetSlot(ctx),
                    "scratch clear ack",
                    SET_SLOT_ACK_TIMEOUT_MS
                );
            } catch (error) {
                if (IMPORT_DEBUG) {
                    ctx.displayMessage(`&7[item-capture] &escratch clear ack timeout: ${error}`);
                }
            }
            await ctx.waitFor("tick");
        }

        const actionItemCount = getStackCount(currentItemSlot.getItem());

        const before = snapshotInventory();
        currentItemSlot.click();
        try {
            await ctx.withTimeout(
                waitForAnySetSlot(ctx),
                "current-item copy ack",
                SET_SLOT_ACK_TIMEOUT_MS
            );
        } catch (error) {
            if (IMPORT_DEBUG) {
                ctx.displayMessage(`&7[item-capture] &ecurrent-item copy ack timeout for "${displayNameHint}": ${error}`);
            }
        }
        await ctx.waitFor("tick");

        const after = snapshotInventory();
        const captured = diffForCapture(before, after, actionItemCount);
        if (captured === null) {
            ctx.displayMessage(
                `&7[item-capture] &eNo inventory change for "${displayNameHint}".`
            );
            return null;
        }

        registered = registry.register(captured.snbt, displayNameHint);
    } finally {
        await clickGoBack(ctx);
    }

    return registered;
}

const CONDITION_ITEM_FIELD_LABEL = "Item";

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

export async function captureItemsForObservedConditions(
    ctx: TaskContext,
    observed: readonly ObservedConditionSlot[],
    registry: ItemCaptureRegistry
): Promise<void> {
    const listLength = observed.length;
    for (let i = 0; i < observed.length; i++) {
        const entry = observed[i];
        const condition = entry.condition;
        if (condition === null) continue;
        if (!isItemBearingCondition(condition.type)) continue;

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
                const captured = await captureItemFromOpenEditorField(
                    ctx,
                    CONDITION_ITEM_FIELD_LABEL,
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

export async function restoreInventoryToSnapshot(
    ctx: TaskContext,
    snapshot: InventorySnapshot
): Promise<void> {
    const inv = Player.getInventory();
    if (inv === null || inv === undefined) return;

    for (let si = 0; si < snapshot.length; si++) {
        const entry = snapshot[si];
        const current = inv.getStackInSlot(entry.slotId);
        const currentNbt =
            current === null || current === undefined
                ? null
                : snbtFromItem(current, { pretty: false });
        const currentCount = getStackCount(current);

        if (currentNbt === entry.nbt && currentCount === entry.count) continue;

        const packetSlot = entry.slotId < 9 ? 36 + entry.slotId : entry.slotId;
        let desiredStack: any = null;
        if (entry.nbt !== null) {
            try {
                desiredStack = getItemFromSnbt(entry.nbt).getItemStack();
            } catch (error) {
                ctx.displayMessage(
                    `&7[item-capture] &eFailed to rebuild slot ${entry.slotId} item from snapshot: ${error}`
                );
                continue;
            }
        }
        sendCreativeInventoryAction(
            ctx,
            packetSlot,
            desiredStack,
        );
        try {
            await ctx.withTimeout(
                waitForAnySetSlot(ctx),
                `restore slot ${entry.slotId} ack`,
                SET_SLOT_ACK_TIMEOUT_MS
            );
        } catch (error) {
            if (IMPORT_DEBUG) {
                ctx.displayMessage(`&7[item-capture] &erestore slot ${entry.slotId} ack timeout: ${error}`);
            }
        }
    }
}
