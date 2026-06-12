import * as htsw from "htsw";
import type { Condition, ImportableItem } from "htsw/types";
import { canonicalStringify } from "./fields/compare";

import TaskContext from "../tasks/context";
import { canonicalSlug } from "../exporter/paths";
import { getItemFromSnbt, itemToHtswTag } from "../utils/nbt";
import { cyrb53, removedFormatting } from "../utils/helpers";
import { clickGoBack } from "./gui/menuUtils";
import { timedWaitForMenu } from "./gui/menuWait";
import {
    SET_SLOT_ACK_TIMEOUT_MS,
    sendCreativeInventoryAction,
    waitForAnySetSlot,
} from "./gui/packets";
import { CONDITION_LIST_CONFIG } from "./actions/conditions/listConfig";
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
export type CapturedItem = {
    name: string;
    snbt: string;
    displayName: string;
    /** True when this entry came from the destination project (seeded), so it
     * already exists on disk and must never be re-written by an export. */
    seeded: boolean;
};

export class ItemCaptureRegistry {
    private byHash: Record<string, CapturedItem> = Object.create(null);
    private nameToHash: Record<string, string> = Object.create(null);
    // Stripped display name → seeded project name, for the "resembles" hint
    // when a NEW capture shares a display name with an existing project item.
    private seededDisplayNames: Record<string, string> = Object.create(null);
    private matchedHashes: Record<string, true> = Object.create(null);
    private hintLines: string[] = [];

    /**
     * Pre-register an item the destination project already declares, so a
     * capture with identical content reuses the project's name instead of
     * minting a new one (and writing a duplicate file). Content identity is
     * the canonical tag hash — key order / formatting don't matter.
     */
    seed(name: string, nbt: ImportableItem["nbt"]): void {
        const hash = canonicalTagHash(nbt);
        if (this.byHash[hash] !== undefined) return; // first declaration wins
        if (this.nameToHash[name] !== undefined) return;
        this.byHash[hash] = { name, snbt: "", displayName: "", seeded: true };
        this.nameToHash[name] = hash;
        const dn = displayNameFromTag(nbt);
        if (dn !== null && this.seededDisplayNames[dn] === undefined) {
            this.seededDisplayNames[dn] = name;
        }
    }

    register(snbt: string, displayNameHint: string): string {
        const hash = nbtHash(snbt);
        const existing = this.byHash[hash];
        if (existing !== undefined) {
            if (existing.seeded) this.matchedHashes[hash] = true;
            return existing.name;
        }

        const preferred = slugForDisplayName(displayNameHint);
        let name = preferred;
        let suffix = 2;
        while (this.nameToHash[name] !== undefined && suffix < 1000) {
            name = `${preferred}_${suffix}`;
            suffix++;
        }

        // New item whose display name matches an existing project item with
        // DIFFERENT content: probably an in-house edit. Don't guess — keep
        // both and tell the user.
        const dn = removedFormatting(displayNameHint).trim().toLowerCase();
        const owner = this.seededDisplayNames[dn];
        if (owner !== undefined) {
            this.hintLines.push(
                `captured '${name}' (new) shares a display name with existing item '${owner}' but has different NBT — if it's an edit, delete the old one`
            );
        }

        this.byHash[hash] = { name, snbt, displayName: displayNameHint, seeded: false };
        this.nameToHash[name] = hash;
        return name;
    }

    /** Entries minted this run — the ones an export must write to disk. */
    newEntries(): CapturedItem[] {
        const out: CapturedItem[] = [];
        for (const hash in this.byHash) {
            if (!this.byHash[hash].seeded) out.push(this.byHash[hash]);
        }
        return out;
    }

    counts(): { matched: number; fresh: number } {
        let matched = 0;
        for (const _h in this.matchedHashes) matched++;
        return { matched, fresh: this.newEntries().length };
    }

    takeHints(): string[] {
        const out = this.hintLines;
        this.hintLines = [];
        return out;
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

// Both sides of matching hash the PARSED tag in canonical (order-independent)
// form: seeds come from project files whose key order is human-authored,
// captures from the live printer — text hashes would never match across the
// two. Unparseable snbt (shouldn't happen — we printed it) falls back to a
// text hash, which can only miss a match, never corrupt one.
function canonicalTagHash(tag: unknown): string {
    return String(cyrb53(canonicalStringify(tag)));
}

function nbtHash(snbt: string): string {
    try {
        return canonicalTagHash(htsw.nbt.parseSnbtText(snbt));
    } catch (_e) {
        return String(cyrb53(snbt));
    }
}

type TagLike = { type: string; value: unknown };

function tagChild(tag: TagLike | undefined, key: string): TagLike | undefined {
    if (tag === undefined || tag.type !== "compound") return undefined;
    return (tag.value as Record<string, TagLike>)[key];
}

function displayNameFromTag(root: unknown): string | null {
    const name = tagChild(tagChild(tagChild(root as TagLike, "tag"), "display"), "Name");
    if (name === undefined || name.type !== "string") return null;
    const stripped = removedFormatting(String(name.value)).trim().toLowerCase();
    return stripped.length > 0 ? stripped : null;
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

export function snbtFromItem(item: Item, opts: { pretty: boolean }): string | null {
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
