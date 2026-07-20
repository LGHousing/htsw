import * as htsw from "htsw";
import type { ImportableItem } from "htsw/types";
import type { Tag } from "htsw/nbt";
import { canonicalStringify } from "./fields/compare";
import {
    type TagLike,
    canonicalItemTag,
    normalizeBlankLoreSeparators,
    stripInteractData,
    tagChild,
} from "./fields/itemTagCanonical";

import TaskContext from "../tasks/context";
import { pollTicks } from "../tasks/poll";
import { canonicalSlug } from "../project/paths";
import {
    extractInteractDataSnbt,
    getItemFromNbt,
    getItemFromSnbt,
    itemToHtswTag,
} from "../utils/nbt";
import { removedFormatting, stableStringify } from "../utils/helpers";
import { getMinecraft, getPlayer } from "../utils/java";
import { closeOpenScreen } from "./sideEffects";
import { clickGoBack } from "./menus/menuUtils";
import { timedWaitForMenu } from "./menus/menuWait";
import {
    SET_SLOT_ACK_MAX_TICKS,
    SET_SLOT_ACK_TIMEOUT_MS,
    selectHotbarSlot,
    sendCreativeInventoryAction,
    waitForAnySetSlot,
} from "./menus/packets";
import { traceNote } from "./trace/taskTrace";
import type { ItemFieldObservation } from "./itemFieldObservations";

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
    inventorySlot?: number;
    expectedInteractData?: InteractDataExpectation;
};

export type InteractDataExpectation =
    { kind: "absent" } | { kind: "cached"; snbt: string } | { kind: "uncached" };

export class ItemCaptureRegistry {
    private byHash = Object.create(null) as Partial<Record<string, CapturedItem>>;
    private nameToHash = Object.create(null) as Partial<Record<string, string>>;
    // Stripped display name → seeded project name, for the "resembles" hint
    // when a NEW capture shares a display name with an existing project item.
    private seededDisplayNames = Object.create(null) as Partial<Record<string, string>>;
    private matchedHashes = Object.create(null) as Record<string, true>;
    private capturedNames = Object.create(null) as Record<string, true>;
    private hintLines: string[] = [];

    /**
     * Pre-register an item the destination project already declares, so a
     * capture with identical content reuses the project's name instead of
     * minting a new one (and writing a duplicate file). Identity is
     * `canonicalItemKey` — both seed and capture round-trip the item through an
     * ItemStack and strip Housing's noise, so a source `{id,Count}` matches the
     * read-back `{id,Count,tag:{display:{}},Damage:0s}` the GUI hands back.
     */
    seedExportItem(
        item: ImportableItem,
        expectedInteractData: InteractDataExpectation
    ): void {
        this.seedHash(
            item.name,
            canonicalItemKey(getItemFromNbt(item.nbt)),
            displayNameFromTag(item.nbt),
            expectedInteractData
        );
    }

    seedNbtOnly(name: string, nbt: ImportableItem["nbt"]): void {
        this.seedHash(
            name,
            canonicalItemKey(getItemFromNbt(nbt)),
            displayNameFromTag(nbt),
            undefined
        );
    }

    private seedHash(
        name: string,
        hash: string,
        displayName: string | null,
        expectedInteractData: InteractDataExpectation | undefined
    ): void {
        if (this.byHash[hash] !== undefined) return; // first declaration wins
        if (this.nameToHash[name] !== undefined) return;
        this.byHash[hash] = {
            name,
            snbt: "",
            displayName: displayName ?? "",
            seeded: true,
            expectedInteractData,
        };
        this.nameToHash[name] = hash;
        if (displayName !== null && this.seededDisplayNames[displayName] === undefined) {
            this.seededDisplayNames[displayName] = name;
        }
    }

    register(snbt: string, displayNameHint: string, inventorySlot?: number): string {
        const normalizedSnbt = normalizeItemSnbtForExport(snbt);
        const hash = canonicalItemKey(getItemFromSnbt(normalizedSnbt));
        const existing = this.byHash[hash];
        if (existing !== undefined) {
            this.capturedNames[existing.name] = true;
            if (
                existing.seeded &&
                existing.expectedInteractData !== undefined &&
                !itemInteractDataMatches(normalizedSnbt, existing.expectedInteractData)
            ) {
                existing.snbt = normalizedSnbt;
                existing.displayName = displayNameHint;
                existing.seeded = false;
                existing.inventorySlot = inventorySlot;
            } else if (existing.seeded) {
                this.matchedHashes[hash] = true;
            }
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

        this.byHash[hash] = {
            name,
            snbt: normalizedSnbt,
            displayName: displayNameHint,
            seeded: false,
            inventorySlot,
        };
        this.nameToHash[name] = hash;
        this.capturedNames[name] = true;
        return name;
    }

    needsWrite(name: string): boolean {
        const hash = this.nameToHash[name];
        return hash !== undefined && this.byHash[hash]?.seeded === false;
    }

    /** Entries minted this run — the ones an export must write to disk. */
    newEntries(): CapturedItem[] {
        const out: CapturedItem[] = [];
        for (const hash in this.byHash) {
            const entry = this.byHash[hash];
            if (entry !== undefined && !entry.seeded) out.push(entry);
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
            const entry = this.byHash[hash];
            if (entry !== undefined) out.push(entry);
        }
        return out;
    }

    capturedItemNames(): string[] {
        return Object.keys(this.capturedNames);
    }

    capturedInteractData(name: string): string | null {
        const hash = this.nameToHash[name];
        const snbt = hash === undefined ? "" : this.byHash[hash]?.snbt;
        return snbt === undefined || snbt.length === 0
            ? null
            : extractInteractDataSnbt(snbt);
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
    return canonicalStringify(canonicalItemTag(itemToHtswTag(item)));
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

function getStackCount(stack: unknown): number {
    if (stack === null || stack === undefined) return 0;
    const item = stack as {
        getItemStack(): HtswMinecraftItemStack | null;
        getStackSize(): number;
    };
    try {
        const n = item.getStackSize();
        if (typeof n === "number") return n;
    } catch (_e) {}
    try {
        const raw = item.getItemStack();
        if (raw !== null) {
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
): { snbt: string; slotId: number } | null {
    let found: { snbt: string; slotId: number } | null = null;
    for (let i = 0; i < before.length; i++) {
        const b = before[i];
        const a = i < after.length ? after[i] : undefined;
        if (a === undefined) continue;
        if (a.nbt === null) continue;
        if (a.nbt === b.nbt && a.count === b.count) continue;
        if (found !== null) return null;
        found = { snbt: rewriteSnbtCount(a.nbt, actionItemCount), slotId: a.slotId };
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
    const container = Player.getContainer() as unknown as
        ReturnType<typeof Player.getContainer> | null | undefined;
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
    const containerSlot =
        view === "openContainer" ? inventorySlotToOpenContainerSlot(entry.slotId) : null;
    return `slot=${entry.slotId} packet=${inventorySlotToPacketSlot(entry.slotId)} container=${containerSlot === null ? "none" : containerSlot} count=${entry.count} identityMatch=${key === targetKey} mergeMatch=${targetMergeKey !== null && candidateKey === targetMergeKey} key=${shortHash(key)} merge=${shortHash(candidateKey)}`;
}

function entryFromItem(
    slotId: number,
    stack: Item | null | undefined
): InventorySnapshotEntry {
    const nbt =
        stack === null || stack === undefined
            ? null
            : snbtFromItem(stack, { pretty: false });
    if (nbt === null) return { slotId, nbt: null, count: 0 };
    return { slotId, nbt, count: getStackCount(stack) };
}

function playerInventoryEntry(slotId: number): InventorySnapshotEntry {
    return entryFromItem(slotId, Player.getInventory()?.getStackInSlot(slotId));
}

function openContainerInventoryEntry(slotId: number): InventorySnapshotEntry {
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
        () =>
            inventoryEntryMatches(
                readInventoryEntry(slotId, view),
                expectedNbt,
                expectedCount
            ),
        { stableTicks: 2 }
    );
}

async function waitForSetSlotAck(ctx: TaskContext, label: string): Promise<void> {
    try {
        await ctx.withTimeout(waitForAnySetSlot(ctx), label, SET_SLOT_ACK_TIMEOUT_MS);
    } catch (error) {
        traceNote("item-capture", `${label} timeout: ${String(error)}`);
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
        if (snapshot[i].nbt !== null)
            nonEmpty.push(
                inventoryEntrySummary(snapshot[i], targetKey, targetMergeKey, view)
            );
    }
    traceNote(
        "item-capture",
        `clear merge candidates target=${shortHash(targetKey)} merge=${shortHash(targetMergeKey)} inventory=[${nonEmpty.join("; ")}]`
    );
    for (let i = 0; i < snapshot.length; i++) {
        const entry = snapshot[i];
        const entryKey = mergeKey(entry.nbt);
        const entryMergeKey = stackMergeCandidateKey(entry.nbt);
        if (
            entryKey !== targetKey &&
            (targetMergeKey === null || entryMergeKey !== targetMergeKey)
        )
            continue;
        traceNote(
            "item-capture",
            `clear merge candidate ${inventoryEntrySummary(entry, targetKey, targetMergeKey, view)}`
        );
        sendCreativeInventoryAction(ctx, inventorySlotToPacketSlot(entry.slotId), null);
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
                (targetMergeKey !== null &&
                    stackMergeCandidateKey(entry.nbt) === targetMergeKey)
            ) {
                afterTick.push(
                    inventoryEntrySummary(
                        readInventoryEntry(entry.slotId, view),
                        targetKey,
                        targetMergeKey,
                        view
                    )
                );
            }
        }
        traceNote("item-capture", `after clear tick inventory=[${afterTick.join("; ")}]`);
    }
}

function findCapturedMatchingStack(
    after: InventorySnapshot,
    targetKey: string,
    actionItemCount: number
): { snbt: string; slotId: number } | null {
    let found: { snbt: string; slotId: number } | null = null;
    for (let i = 0; i < after.length; i++) {
        const entry = after[i];
        if (mergeKey(entry.nbt) !== targetKey || entry.nbt === null) continue;
        if (found !== null) return null;
        found = {
            snbt: rewriteSnbtCount(entry.nbt, actionItemCount),
            slotId: entry.slotId,
        };
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
): { snbt: string; slotId: number } | null {
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
): Promise<{ snbt: string; slotId: number } | null> {
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
        return htsw.nbt.printSnbt(normalizeBlankLoreSeparators(tag) as Tag, {
            pretty: true,
        });
    } catch (_error) {
        return snbt;
    }
}

export function itemInteractDataMatches(
    itemSnbt: string,
    expected: InteractDataExpectation
): boolean {
    if (expected.kind === "uncached") return false;
    const observed = interactDataTag(itemSnbt);
    if (expected.kind === "absent") return observed === null;
    if (observed === null) return false;
    return canonicalSnbt(observed) === canonicalSnbt(expected.snbt);
}

function interactDataTag(itemSnbt: string): unknown {
    try {
        const item = htsw.nbt.parseSnbtText(itemSnbt) as TagLike;
        return (
            tagChild(
                tagChild(tagChild(item, "tag"), "ExtraAttributes"),
                "interact_data"
            ) ?? null
        );
    } catch (_error) {
        return null;
    }
}

function canonicalSnbt(value: unknown): string | null {
    try {
        const parsed = typeof value === "string" ? htsw.nbt.parseSnbtText(value) : value;
        return stableStringify(parsed);
    } catch (_error) {
        return null;
    }
}

export function portableItemSnbt(snbt: string): string {
    try {
        const tag = htsw.nbt.parseSnbtText(snbt);
        return htsw.nbt.printSnbt(
            stripInteractData(normalizeBlankLoreSeparators(tag)) as Tag,
            { pretty: true }
        );
    } catch (_error) {
        return snbt;
    }
}

export function normalizeItemSnbtForExport(snbt: string): string {
    try {
        const tag = htsw.nbt.parseSnbtText(snbt);
        return htsw.nbt.printSnbt(normalizeBlankLoreSeparators(tag) as Tag, {
            pretty: false,
        });
    } catch (_error) {
        return snbt;
    }
}

export function snbtFromItem(item: Item, opts: { pretty: boolean }): string {
    const tag = itemToHtswTag(item);
    return htsw.nbt.printSnbt(normalizeBlankLoreSeparators(tag) as Tag, {
        pretty: opts.pretty,
    });
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
        let retainCapturedItem = false;
        try {
            await clearMergeCandidates(
                ctx,
                inventoryView,
                originalInventory,
                targetKey,
                targetMergeKey
            );

            if (isInventoryFull(inventoryView)) {
                sendCreativeInventoryAction(ctx, SCRATCH_PACKET_SLOT, null);
                await waitForSetSlotAck(ctx, "scratch clear ack");
                await waitForInventorySlotMatch(
                    ctx,
                    inventoryView,
                    SCRATCH_PACKET_SLOT,
                    null,
                    0
                );
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

            registered = registry.register(
                captured.snbt,
                displayNameHint,
                captured.slotId
            );
            retainCapturedItem = registry.needsWrite(registered);
        } finally {
            if (!retainCapturedItem) {
                await restoreInventoryToSnapshot(ctx, originalInventory, inventoryView);
            }
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
            await clearMergeCandidates(
                ctx,
                inventoryView,
                originalInventory,
                targetKey,
                targetMergeKey
            );

            if (isInventoryFull(inventoryView)) {
                sendCreativeInventoryAction(ctx, SCRATCH_PACKET_SLOT, null);
                await waitForSetSlotAck(ctx, "scratch clear ack");
                await waitForInventorySlotMatch(
                    ctx,
                    inventoryView,
                    SCRATCH_PACKET_SLOT,
                    null,
                    0
                );
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
                canonicalKey: canonicalItemKey(getItemFromSnbt(captured.snbt)),
            };
        } finally {
            await restoreInventoryToSnapshot(ctx, originalInventory, inventoryView);
        }
    } finally {
        await clickGoBack(ctx);
    }
}

function inventoryContainerSlot(slotId: number): number {
    return slotId < 9 ? 36 + slotId : slotId;
}

export async function holdCapturedItem(
    ctx: TaskContext,
    item: CapturedItem
): Promise<void> {
    const slotId = item.inventorySlot;
    if (slotId === undefined) {
        throw new Error(`captured item "${item.name}" has no retained inventory slot`);
    }

    await closeOpenScreen(ctx);
    if (slotId >= 9) {
        const player = getPlayer();
        const controller = getMinecraft().field_71442_b;
        const sourceSlot = inventoryContainerSlot(slotId);
        controller.func_78753_a(0, sourceSlot, 0, 0, player);
        controller.func_78753_a(0, 36, 0, 0, player);
        controller.func_78753_a(0, sourceSlot, 0, 0, player);
        await ctx.waitFor("tick");
    }

    selectHotbarSlot(ctx, slotId < 9 ? slotId : 0);
    await ctx.waitFor("tick");
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
        let desiredStack: HtswMinecraftItemStack | null = null;
        if (entry.nbt !== null) {
            try {
                desiredStack = getItemFromSnbt(entry.nbt).getItemStack();
            } catch (error) {
                ctx.displayMessage(
                    `&7[item-capture] &eFailed to rebuild slot ${entry.slotId} item from snapshot: ${String(error)}`
                );
                continue;
            }
        }
        sendCreativeInventoryAction(ctx, packetSlot, desiredStack);
        try {
            await ctx.withTimeout(
                waitForAnySetSlot(ctx),
                `restore slot ${entry.slotId} ack`,
                SET_SLOT_ACK_TIMEOUT_MS
            );
        } catch (error) {
            traceNote(
                "item-capture",
                `restore slot ${entry.slotId} ack timeout: ${String(error)}`
            );
        }
        const restored = await waitForInventorySlotMatch(
            ctx,
            view,
            entry.slotId,
            entry.nbt,
            entry.count
        );
        if (!restored) {
            const currentEntry = readInventoryEntry(entry.slotId, view);
            traceNote(
                "item-capture",
                `restore slot ${entry.slotId} did not settle at snapshot; now nbt=${shortHash(currentEntry.nbt)} count=${currentEntry.count}`
            );
        }
    }
}
