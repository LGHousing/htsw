import * as htsw from "htsw";
import type { ImportableItem } from "htsw/types";
import { canonicalStringify } from "./fields/compare";

import TaskContext from "../tasks/context";
import { canonicalSlug } from "../project/paths";
import { getItemFromNbt, getItemFromSnbt, itemToHtswTag } from "../utils/nbt";
import { removedFormatting } from "../utils/helpers";
import { clickGoBack } from "./gui/menuUtils";
import { timedWaitForMenu } from "./gui/menuWait";
import {
    SET_SLOT_ACK_TIMEOUT_MS,
    sendCreativeInventoryAction,
    waitForAnySetSlot,
} from "./gui/packets";
import { IMPORT_DEBUG } from "./diagnostics/importDebug";

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
     * minting a new one (and writing a duplicate file). Identity is
     * `canonicalItemKey` — both seed and capture round-trip the item through an
     * ItemStack and strip Housing's noise, so a source `{id,Count}` matches the
     * read-back `{id,Count,tag:{display:{}},Damage:0s}` the GUI hands back.
     */
    seed(name: string, nbt: ImportableItem["nbt"]): void {
        this.seedHash(name, canonicalItemKey(getItemFromNbt(nbt)), displayNameFromTag(nbt));
    }

    seedSnbtText(name: string, snbt: string): void {
        let displayName: string | null = null;
        try {
            displayName = displayNameFromTag(htsw.nbt.parseSnbtText(snbt));
        } catch (_e) {}
        this.seedHash(name, canonicalItemKey(getItemFromSnbt(snbt)), displayName);
    }

    private seedHash(name: string, hash: string, displayName: string | null): void {
        if (this.byHash[hash] !== undefined) return; // first declaration wins
        if (this.nameToHash[name] !== undefined) return;
        this.byHash[hash] = { name, snbt: "", displayName: "", seeded: true };
        this.nameToHash[name] = hash;
        if (displayName !== null && this.seededDisplayNames[displayName] === undefined) {
            this.seededDisplayNames[displayName] = name;
        }
    }

    register(snbt: string, displayNameHint: string): string {
        const hash = canonicalItemKey(getItemFromSnbt(snbt));
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

type TagLike = { type: string; value: unknown };

function tagChild(tag: TagLike | undefined, key: string): TagLike | undefined {
    if (tag === undefined || tag.type !== "compound") return undefined;
    return (tag.value as Record<string, TagLike>)[key];
}

function stripEmptyCompounds(tag: TagLike): TagLike {
    if (tag.type !== "compound") return tag;
    const value = tag.value as Record<string, TagLike>;
    const out: Record<string, TagLike> = {};
    for (const key of Object.keys(value)) {
        const child = stripEmptyCompounds(value[key]);
        if (
            child.type === "compound" &&
            Object.keys(child.value as Record<string, unknown>).length === 0
        ) {
            continue;
        }
        out[key] = child;
    }
    return { type: "compound", value: out };
}

// Drop `tag.ExtraAttributes.interact_data` — the housing-scoped encoding of an
// item's click actions — from a tag, rebuilding only the path it sits on. It's
// non-portable, so it must never be part of an item's identity (an action item
// reads back with it; its source has none).
function stripInteractData(tag: TagLike): TagLike {
    if (tag.type !== "compound") return tag;
    const value = tag.value as Record<string, TagLike>;
    const inner = value["tag"];
    if (inner === undefined || inner.type !== "compound") return tag;
    const innerValue = inner.value as Record<string, TagLike>;
    const extra = innerValue["ExtraAttributes"];
    if (extra === undefined || extra.type !== "compound") return tag;
    const extraValue = extra.value as Record<string, TagLike>;
    if (extraValue["interact_data"] === undefined) return tag;

    const newExtra: Record<string, TagLike> = {};
    for (const k of Object.keys(extraValue)) {
        if (k !== "interact_data") newExtra[k] = extraValue[k];
    }
    const newInner: Record<string, TagLike> = {};
    for (const k of Object.keys(innerValue)) {
        newInner[k] = k === "ExtraAttributes" ? { type: "compound", value: newExtra } : innerValue[k];
    }
    const newRoot: Record<string, TagLike> = {};
    for (const k of Object.keys(value)) {
        newRoot[k] = k === "tag" ? { type: "compound", value: newInner } : value[k];
    }
    return { type: "compound", value: newRoot };
}

/**
 * Canonical comparison key for an item's NBT that ignores non-portable Housing
 * additions — the empty `tag:{display:{}}` it stamps on placed items, and the
 * `interact_data` click-action encoding. Two items with the same key are the
 * same item for import, so a placed/action item compares equal to its source.
 */
export function canonicalItemKey(item: Item): string {
    const tag = itemToHtswTag(item) as TagLike | null;
    if (tag === null) return "<null>";
    return canonicalStringify(stripEmptyCompounds(stripInteractData(tag)));
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

function mergeKey(snbt: string | null): string | null {
    return snbt === null ? null : rewriteSnbtCount(snbt, 1);
}

function inventorySlotToPacketSlot(slotId: number): number {
    return slotId < 9 ? 36 + slotId : slotId;
}

async function waitForSetSlotAck(
    ctx: TaskContext,
    label: string
): Promise<void> {
    try {
        await ctx.withTimeout(
            waitForAnySetSlot(ctx),
            label,
            SET_SLOT_ACK_TIMEOUT_MS
        );
    } catch (error) {
        if (IMPORT_DEBUG) {
            ctx.displayMessage(`&7[item-capture] &e${label} timeout: ${error}`);
        }
    }
}

async function clearMergeCandidates(
    ctx: TaskContext,
    snapshot: InventorySnapshot,
    targetKey: string
): Promise<void> {
    let cleared = false;
    for (let i = 0; i < snapshot.length; i++) {
        const entry = snapshot[i];
        if (mergeKey(entry.nbt) !== targetKey) continue;
        sendCreativeInventoryAction(
            ctx,
            inventorySlotToPacketSlot(entry.slotId),
            null,
        );
        cleared = true;
        await waitForSetSlotAck(ctx, `clear merge slot ${entry.slotId}`);
    }
    if (cleared) await ctx.waitFor("tick");
}

function findCapturedMatchingStack(
    after: InventorySnapshot,
    targetKey: string,
    actionItemCount: number
): { snbt: string } | null {
    let found: { snbt: string } | null = null;
    for (let i = 0; i < after.length; i++) {
        const entry = after[i];
        if (mergeKey(entry.nbt) !== targetKey || entry.nbt === null) continue;
        if (found !== null) return null;
        found = { snbt: rewriteSnbtCount(entry.nbt, actionItemCount) };
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

        const actionItemCount = getStackCount(currentItemSlot.getItem());
        const currentSnbt = snbtFromItem(currentItemSlot.getItem(), { pretty: false });
        const targetKey = mergeKey(currentSnbt);
        if (targetKey === null) {
            ctx.displayMessage(
                `&7[item-capture] &eCould not read current item NBT for "${displayNameHint}".`
            );
            return null;
        }

        const before = snapshotInventory();
        try {
            await clearMergeCandidates(ctx, before, targetKey);

            if (isInventoryFull()) {
                sendCreativeInventoryAction(ctx, SCRATCH_PACKET_SLOT, null);
                await waitForSetSlotAck(ctx, "scratch clear ack");
                await ctx.waitFor("tick");
            }

            currentItemSlot.click();
            await waitForSetSlotAck(ctx, `current-item copy ack for "${displayNameHint}"`);
            await ctx.waitFor("tick");

            const after = snapshotInventory();
            let captured = findCapturedMatchingStack(
                after,
                targetKey,
                actionItemCount
            );
            if (captured === null) {
                captured = diffForCapture(before, after, actionItemCount);
            }
            if (captured === null) {
                ctx.displayMessage(
                    `&7[item-capture] &eNo inventory change for "${displayNameHint}".`
                );
                return null;
            }

            registered = registry.register(captured.snbt, displayNameHint);
        } finally {
            await restoreInventoryToSnapshot(ctx, before);
        }
    } finally {
        await clickGoBack(ctx);
    }

    return registered;
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

        const packetSlot = inventorySlotToPacketSlot(entry.slotId);
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
