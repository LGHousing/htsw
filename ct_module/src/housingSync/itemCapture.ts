import * as htsw from "htsw";
import type { ImportableItem } from "htsw/types";
import type { Tag } from "htsw/nbt";
import { canonicalStringify } from "./fields/compare";
import {
    type TagLike,
    canonicalItemTag,
    normalizeBlankLoreSeparators,
    tagChild,
} from "./fields/itemTagCanonical";

import TaskContext from "../tasks/context";
import { pollTicks } from "../tasks/poll";
import { canonicalSlug } from "../project/paths";
import { getItemFromNbt, getItemFromSnbt, itemToHtswTag } from "../utils/nbt";
import { removedFormatting } from "../utils/helpers";
import { clickGoBack } from "./menus/menuUtils";
import { timedWaitForMenu } from "./menus/menuWait";
import {
    SET_SLOT_ACK_MAX_TICKS,
    SET_SLOT_ACK_TIMEOUT_MS,
    sendCreativeInventoryAction,
    waitForAnySetSlot,
} from "./menus/packets";
import { traceNote } from "./trace/taskTrace";

const SCRATCH_PACKET_SLOT = 26;
const INVENTORY_SIZE = 36;

type InventoryView = "player" | "openContainer";
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
        const normalizedSnbt = normalizeItemSnbtForExport(snbt);
        const hash = canonicalItemKey(getItemFromSnbt(normalizedSnbt));
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

        this.byHash[hash] = { name, snbt: normalizedSnbt, displayName: displayNameHint, seeded: false };
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

/**
 * Canonical comparison key for an item's NBT that ignores non-portable Housing
 * additions and vanilla stack defaults — the rules live in ONE place,
 * `fields/itemTagCanonical.ts`, shared with the drift hash so the two paths
 * cannot disagree. Two items with the same key are the same item for import,
 * so a placed/action item compares equal to its source.
 */
export function canonicalItemKey(item: Item): string {
    const tag = itemToHtswTag(item) as TagLike | null;
    if (tag === null) return "<null>";
    return canonicalStringify(canonicalItemTag(tag));
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
    return snapshotInventoryView("player");
}

function snapshotOpenContainerInventory(): InventorySnapshot {
    return snapshotInventoryView("openContainer");
}

function snapshotInventoryView(view: InventoryView): InventorySnapshot {
    const snapshot: InventorySnapshot = [];
    for (let i = 0; i < INVENTORY_SIZE; i++) {
        snapshot.push(readInventoryEntry(i, view));
    }
    return snapshot;
}

function isInventoryFull(view: InventoryView): boolean {
    for (let i = 0; i < INVENTORY_SIZE; i++) {
        if (readInventoryEntry(i, view).nbt === null) return false;
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
    if (snbt === null) return null;
    try {
        return canonicalItemKey(getItemFromSnbt(rewriteSnbtCount(snbt, 1)));
    } catch (_error) {
        return rewriteSnbtCount(snbt, 1);
    }
}

function primitiveTagString(tag: TagLike | undefined): string {
    if (tag === undefined) return "";
    return String(tag.value);
}

function stackMergeCandidateKey(snbt: string | null): string | null {
    if (snbt === null) return null;
    try {
        const tag = htsw.nbt.parseSnbtText(rewriteSnbtCount(snbt, 1)) as TagLike;
        if (tag.type !== "compound") return null;
        const damage = primitiveTagString(tagChild(tag, "Damage")) || "0";
        return `id=${primitiveTagString(tagChild(tag, "id"))};damage=${damage}`;
    } catch (_error) {
        return null;
    }
}

function inventorySlotToPacketSlot(slotId: number): number {
    return slotId < 9 ? 36 + slotId : slotId;
}

function inventorySlotToOpenContainerSlot(slotId: number): number | null {
    const container = Player.getContainer();
    if (container === null || container === undefined) return null;
    const size = container.getSize();
    if (size < INVENTORY_SIZE) return null;
    if (slotId < 9) return size - 9 + slotId;
    return size - INVENTORY_SIZE + (slotId - 9);
}

function shortHash(value: string | null): string {
    if (value === null) return "null";
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
        hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
    }
    return String(hash);
}

function inventoryEntrySummary(
    entry: InventorySnapshotEntry,
    targetKey: string,
    targetMergeKey: string | null,
    view: InventoryView
): string {
    const key = mergeKey(entry.nbt);
    const candidateKey = stackMergeCandidateKey(entry.nbt);
    const containerSlot = view === "openContainer"
        ? inventorySlotToOpenContainerSlot(entry.slotId)
        : null;
    return `slot=${entry.slotId} packet=${inventorySlotToPacketSlot(entry.slotId)} container=${containerSlot === null ? "none" : containerSlot} count=${entry.count} identityMatch=${key === targetKey} mergeMatch=${targetMergeKey !== null && candidateKey === targetMergeKey} key=${shortHash(key)} merge=${shortHash(candidateKey)}`;
}

function entryFromItem(slotId: number, stack: Item | null | undefined): InventorySnapshotEntry {
    const nbt = stack === null || stack === undefined ? null : snbtFromItem(stack, { pretty: false });
    if (nbt === null) return { slotId, nbt: null, count: 0 };
    return { slotId, nbt, count: getStackCount(stack) };
}

function playerInventoryEntry(slotId: number): InventorySnapshotEntry {
    return entryFromItem(slotId, Player.getInventory()?.getStackInSlot(slotId));
}

function openContainerInventoryEntry(slotId: number): InventorySnapshotEntry {
    const containerSlot = inventorySlotToOpenContainerSlot(slotId);
    if (containerSlot !== null) {
        const item = Player.getContainer()?.getItems()?.[containerSlot];
        return entryFromItem(slotId, item);
    }
    return playerInventoryEntry(slotId);
}

function readInventoryEntry(slotId: number, view: InventoryView): InventorySnapshotEntry {
    return view === "openContainer"
        ? openContainerInventoryEntry(slotId)
        : playerInventoryEntry(slotId);
}

function inventoryEntryMatches(
    entry: InventorySnapshotEntry,
    expectedNbt: string | null,
    expectedCount: number
): boolean {
    return entry.nbt === expectedNbt && entry.count === expectedCount;
}

async function waitForInventorySlotMatch(
    ctx: TaskContext,
    view: InventoryView,
    slotId: number,
    expectedNbt: string | null,
    expectedCount: number
): Promise<boolean> {
    return pollTicks(
        ctx,
        SET_SLOT_ACK_MAX_TICKS,
        () => inventoryEntryMatches(readInventoryEntry(slotId, view), expectedNbt, expectedCount),
        { stableTicks: 2 }
    );
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
        traceNote("item-capture", `${label} timeout: ${error}`);
    }
}

async function clearMergeCandidates(
    ctx: TaskContext,
    view: InventoryView,
    snapshot: InventorySnapshot,
    targetKey: string,
    targetMergeKey: string | null
): Promise<void> {
    let cleared = false;
    const nonEmpty: string[] = [];
    for (let i = 0; i < snapshot.length; i++) {
        if (snapshot[i].nbt !== null) nonEmpty.push(inventoryEntrySummary(snapshot[i], targetKey, targetMergeKey, view));
    }
    traceNote(
        "item-capture",
        `clear merge candidates target=${shortHash(targetKey)} merge=${shortHash(targetMergeKey)} inventory=[${nonEmpty.join("; ")}]`
    );
    for (let i = 0; i < snapshot.length; i++) {
        const entry = snapshot[i];
        const entryKey = mergeKey(entry.nbt);
        const entryMergeKey = stackMergeCandidateKey(entry.nbt);
        if (entryKey !== targetKey && (targetMergeKey === null || entryMergeKey !== targetMergeKey)) continue;
        traceNote(
            "item-capture",
            `clear merge candidate ${inventoryEntrySummary(entry, targetKey, targetMergeKey, view)}`
        );
        sendCreativeInventoryAction(
            ctx,
            inventorySlotToPacketSlot(entry.slotId),
            null,
        );
        cleared = true;
        await waitForSetSlotAck(ctx, `clear merge slot ${entry.slotId}`);
        const matched = await waitForInventorySlotMatch(ctx, view, entry.slotId, null, 0);
        traceNote(
            "item-capture",
            `after clear wait settled=${matched} ${inventoryEntrySummary(readInventoryEntry(entry.slotId, view), targetKey, targetMergeKey, view)}`
        );
    }
    if (cleared) {
        await ctx.waitFor("tick");
        const afterTick: string[] = [];
        for (let i = 0; i < snapshot.length; i++) {
            const entry = snapshot[i];
            if (
                mergeKey(entry.nbt) === targetKey ||
                (targetMergeKey !== null && stackMergeCandidateKey(entry.nbt) === targetMergeKey)
            ) {
                afterTick.push(inventoryEntrySummary(readInventoryEntry(entry.slotId, view), targetKey, targetMergeKey, view));
            }
        }
        traceNote("item-capture", `after clear tick inventory=[${afterTick.join("; ")}]`);
    }
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

function snapshotHasMatchingStack(
    snapshot: InventorySnapshot,
    targetKey: string
): boolean {
    for (let i = 0; i < snapshot.length; i++) {
        if (mergeKey(snapshot[i].nbt) === targetKey) return true;
    }
    return false;
}

function capturedFromInventory(
    baseline: InventorySnapshot,
    current: InventorySnapshot,
    targetKey: string,
    actionItemCount: number
): { snbt: string } | null {
    const changed = diffForCapture(baseline, current, actionItemCount);
    if (changed !== null) return changed;
    if (snapshotHasMatchingStack(baseline, targetKey)) return null;
    return findCapturedMatchingStack(current, targetKey, actionItemCount);
}

async function waitForCapturedInventoryChange(
    ctx: TaskContext,
    view: InventoryView,
    baseline: InventorySnapshot,
    targetKey: string,
    actionItemCount: number
): Promise<{ snbt: string } | null> {
    for (let i = 0; i < SET_SLOT_ACK_MAX_TICKS; i++) {
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
        return htsw.nbt.printSnbt(normalizeBlankLoreSeparators(tag) as Tag, { pretty: true });
    } catch (_error) {
        return snbt;
    }
}

export function normalizeItemSnbtForExport(snbt: string): string {
    try {
        const tag = htsw.nbt.parseSnbtText(snbt);
        return htsw.nbt.printSnbt(normalizeBlankLoreSeparators(tag) as Tag, { pretty: false });
    } catch (_error) {
        return snbt;
    }
}

export function snbtFromItem(item: Item, opts: { pretty: boolean }): string | null {
    const tag = itemToHtswTag(item);
    if (tag === null) return null;
    return htsw.nbt.printSnbt(normalizeBlankLoreSeparators(tag as TagLike) as Tag, { pretty: opts.pretty });
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
        const targetMergeKey = stackMergeCandidateKey(currentSnbt);
        if (targetKey === null) {
            ctx.displayMessage(
                `&7[item-capture] &eCould not read current item NBT for "${displayNameHint}".`
            );
            return null;
        }

        const inventoryView: InventoryView = "openContainer";
        const originalInventory = snapshotOpenContainerInventory();
        try {
            await clearMergeCandidates(ctx, inventoryView, originalInventory, targetKey, targetMergeKey);

            if (isInventoryFull(inventoryView)) {
                sendCreativeInventoryAction(ctx, SCRATCH_PACKET_SLOT, null);
                await waitForSetSlotAck(ctx, "scratch clear ack");
                await waitForInventorySlotMatch(ctx, inventoryView, SCRATCH_PACKET_SLOT, null, 0);
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

            registered = registry.register(captured.snbt, displayNameHint);
        } finally {
            await restoreInventoryToSnapshot(ctx, originalInventory, inventoryView);
        }
    } finally {
        await clickGoBack(ctx);
    }

    return registered;
}

export async function restoreInventoryToSnapshot(
    ctx: TaskContext,
    snapshot: InventorySnapshot,
    view: InventoryView = "player"
): Promise<void> {
    for (let si = 0; si < snapshot.length; si++) {
        const entry = snapshot[si];
        const current = readInventoryEntry(entry.slotId, view);
        if (inventoryEntryMatches(current, entry.nbt, entry.count)) continue;

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
            traceNote("item-capture", `restore slot ${entry.slotId} ack timeout: ${error}`);
        }
        const restored = await waitForInventorySlotMatch(ctx, view, entry.slotId, entry.nbt, entry.count);
        if (!restored) {
            const currentEntry = readInventoryEntry(entry.slotId, view);
            traceNote(
                "item-capture",
                `restore slot ${entry.slotId} did not settle at snapshot; now nbt=${shortHash(currentEntry.nbt)} count=${currentEntry.count}`
            );
        }
    }
}
