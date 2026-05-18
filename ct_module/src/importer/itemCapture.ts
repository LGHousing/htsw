import * as htsw from "htsw";

import TaskContext from "../tasks/context";
import { canonicalSlug } from "../exporter/paths";
import { getItemFromSnbt, itemToHtswTag } from "../utils/nbt";
import { removedFormatting } from "../utils/helpers";
import { clickGoBack, timedWaitForMenu } from "./helpers";
import {
    SET_SLOT_ACK_TIMEOUT_MS,
    sendCreativeInventoryAction,
    waitForAnySetSlot,
} from "./packets";

/**
 * Click-to-copy item capture for action / condition "Item" fields. The
 * action editor's Item slot shows the Hypixel UI overlay item, NOT the
 * real housing-tagged item — see `commands.ts probeItem` for the
 * diagnostic that proved the difference. To get the real NBT we click the
 * field, click "Current Item" inside the resulting submenu, and snapshot
 * the player inventory to see where the server placed the copy.
 */

const SCRATCH_PACKET_SLOT = 26; // matches items.ts INV_PACKET_SLOT
const INVENTORY_SIZE = 36; // hotbar (0-8) + main inv (9-35)

export type InventorySnapshotEntry = {
    slotId: number;
    nbt: string | null;
    count: number;
};
export type InventorySnapshot = InventorySnapshotEntry[];
export type CapturedItem = { name: string; snbt: string; displayName: string };

/**
 * Per-export collection of captured items, keyed by NBT content. Multiple
 * action/condition fields that all point at the same housing item produce
 * one registry entry and one `.snbt` file. Names are derived from the
 * first lore display name we see; subsequent captures of the same NBT
 * reuse it.
 */
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
    // Lightweight cyrb-style hash. We only need stable dedup within a
    // single export run, not cryptographic resistance.
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < snbt.length; i++) {
        const ch = snbt.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 =
        Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
        Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 =
        Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
        Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16) + (h1 >>> 0).toString(16);
}

function slugForDisplayName(displayName: string): string {
    const stripped = removedFormatting(displayName).trim().toLowerCase();
    if (stripped.length === 0) return "captured_item";
    const slug = canonicalSlug(stripped);
    return slug.length > 0 ? slug : "captured_item";
}

function getStackCount(stack: any): number {
    if (stack === null || stack === undefined) return 0;
    // CT Item wrapper exposes getStackSize(). Fall back to the underlying
    // ItemStack's stackSize field if the wrapper doesn't have it.
    try {
        const n = stack.getStackSize();
        if (typeof n === "number") return n;
    } catch (_e) {
        // fall through
    }
    try {
        const raw = stack.getItemStack();
        if (raw !== null && raw !== undefined) {
            const field = raw.field_77994_a; // ItemStack.stackSize in 1.8.9
            if (typeof field === "number") return field;
        }
    } catch (_e) {
        // fall through
    }
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
        // Walk the MC NBT graph structurally instead of going through
        // `getRawNBT()`. The structured walk emits canonical SNBT (sandy's
        // printer format) that round-trips cleanly. `getRawNBT()` uses
        // `NBTTagCompound.toString()` which in 1.8.9 produces a debugging
        // list format (`[0:val,1:val]`) that neither HTSW's parser nor
        // MC's `JsonToNBT` will parse — fine for compare-equality between
        // before/after snapshots, but fragile when used downstream.
        const canonical = snbtFromItem(stack, { pretty: false });
        snapshot.push({
            slotId: i,
            nbt: canonical,
            count: getStackCount(stack),
        });
    }
    return snapshot;
}

export function isInventoryFull(): boolean {
    const inv = Player.getInventory();
    if (inv === null || inv === undefined) return false;
    for (let i = 0; i < INVENTORY_SIZE; i++) {
        const stack = inv.getStackInSlot(i);
        if (stack === null || stack === undefined) return false;
    }
    return true;
}

/**
 * Find ANY inventory slot whose contents changed between `before` and
 * `after`, and produce the captured NBT with the `Count` field rewritten
 * to `actionItemCount` (read directly from the housing "Current Item"
 * slot before the click). Returns null if no change was observed.
 *
 * Why we don't need delta math: the Current Item slot's stack size IS
 * the count the action gives — read from the source of truth directly,
 * not inferred from inventory side effects. So for a `diamond × 5`
 * action that lands in 2 slots due to stacking + overflow, we don't
 * care which slots changed or by how much; we just need ONE slot's NBT
 * (the housing-tagged version) and stamp Count:5 on it.
 *
 * Any changed slot works as the NBT source — Minecraft's stacking rule
 * guarantees they all share the same NBT identity. We pick the first.
 */
function diffForCapture(
    before: InventorySnapshot,
    after: InventorySnapshot,
    actionItemCount: number
): { snbt: string } | null {
    for (let i = 0; i < before.length; i++) {
        const b = before[i];
        const a = after[i];
        if (a === undefined) continue;
        if (a.nbt === null) continue;
        if (a.nbt === b.nbt && a.count === b.count) continue;
        return { snbt: rewriteSnbtCount(a.nbt, actionItemCount) };
    }
    return null;
}

/**
 * Replace the root-level `Count:Nb` field in an item SNBT string with
 * `Count:<newCount>b`. ItemStack SNBT always has Count at the root.
 *
 * Stays inside sandy's canonical pipeline: parse with `parseSnbtText`,
 * mutate the Tag, re-print with `printSnbt`. The earlier MC-NBT path
 * (`JsonToNBT.parse` → `setByte` → `toString`) corrupted the output by
 * routing through `NBTTagCompound.toString()`, which in 1.8.9 emits
 * the debugging `[0:val]` list format — undoing every bit of cleanup
 * `snbtFromItem` had just done with the structured walk.
 *
 * Falls back to a regex replacement if the parse fails for any reason
 * (shouldn't happen for canonical input).
 */
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
    } catch (_error) {
        // fall through
    }
    return snbt.replace(/(^|[{,])Count:-?\d+b/, `$1Count:${newCount}b`);
}

/**
 * Pretty-print a canonical SNBT string into the multi-line, indented
 * form HTSW uses for hand-edited examples. Parses with sandy's holy
 * parser then re-emits via the same printer.
 *
 * Pre-condition: the input must already be canonical SNBT (the format
 * `htsw.nbt.printSnbt` produces, or hand-written `.snbt` files). DO
 * NOT pass raw `Item.getRawNBT()` output directly — 1.8.9's NBT
 * `toString()` uses a debugging `[0:val,1:val]` list format that
 * neither HTSW's parser nor MC's own `JsonToNBT` will parse back. Use
 * `prettySnbtFromItem` instead, which goes through the structured
 * walk in `utils/nbt.ts`.
 *
 * On parse failure (malformed input), falls back to the raw string so
 * a write at least produces SOMETHING readable.
 */
export function prettySnbt(snbt: string): string {
    try {
        const tag = htsw.nbt.parseSnbtText(snbt);
        return htsw.nbt.printSnbt(tag, { pretty: true });
    } catch (_error) {
        return snbt;
    }
}

/**
 * Produce canonical SNBT text (pretty or compact) directly from a CT
 * `Item`. Walks the live MC NBT graph via `itemToHtswTag` rather than
 * stringifying through `getRawNBT()`, so the output is genuinely
 * canonical with no MC 1.8.9 `toString` quirks to clean up afterwards.
 *
 * Returns null if the item is missing/empty.
 */
export function snbtFromItem(item: Item, opts: { pretty: boolean }): string | null {
    const tag = itemToHtswTag(item);
    if (tag === null) return null;
    return htsw.nbt.printSnbt(tag, { pretty: opts.pretty });
}

/**
 * Capture the real housing-tagged NBT from the currently-open action /
 * condition editor's "Item" field.
 *
 * Preconditions: ctx is inside an editor that has a slot named `fieldName`
 * (typically "Item") visible — this is the Item field on GIVE_ITEM /
 * REMOVE_ITEM / DROP_ITEM / HAS_ITEM / IS_ITEM / BLOCK_TYPE.
 *
 * Postconditions on every code path: the editor is open again (we click
 * back out of the Item submenu before returning). The captured item is
 * left in the player's inventory — we don't attempt to clean it up here
 * since the snapshot/restore happens at the export-flow level.
 *
 * Returns the canonical name the registry assigned, or null if capture
 * failed (no Current Item slot, inventory full and scratch-clear didn't
 * help, no inventory change observed). Callers should leave `itemName`
 * undefined in the null case so the emitter falls through to the
 * <item-not-supported> placeholder + diagnostic.
 */
export async function captureItemFromOpenActionField(
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

        // If every inventory slot is occupied, Hypixel will refuse the
        // copy with "Unable to add item to inventory as your inventory is
        // full!". Pre-clear the same scratch slot the importer uses so
        // the copy has somewhere to land.
        if (isInventoryFull()) {
            sendCreativeInventoryAction(
                ctx,
                SCRATCH_PACKET_SLOT,
                null,
                `clearing scratch slot ${SCRATCH_PACKET_SLOT} for item capture`
            );
            try {
                await ctx.withTimeout(
                    waitForAnySetSlot(ctx),
                    "scratch clear ack",
                    SET_SLOT_ACK_TIMEOUT_MS
                );
            } catch (_error) {
                // Best effort — proceed; some setups don't echo SetSlot
                // for the cleared slot.
            }
            await ctx.waitFor("tick");
        }

        // The Current Item slot's stack size IS the count the action
        // configures. The slot's own NBT is the housing UI overlay (not
        // usable directly), but its stack size is real. Grab it before
        // we click — once we click, the slot may be consumed or change
        // state.
        const actionItemCount = getStackCount(currentItemSlot.getItem());

        const before = snapshotInventory();
        currentItemSlot.click();
        try {
            await ctx.withTimeout(
                waitForAnySetSlot(ctx),
                "current-item copy ack",
                SET_SLOT_ACK_TIMEOUT_MS
            );
        } catch (_error) {
            // Fall through to diff; the copy may have arrived as a bulk
            // S30PacketWindowItems instead of an individual SetSlot.
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

/**
 * Restore inventory state to `snapshot` by sending creative-inventory
 * packets for every slot whose contents drifted. Used at end of export
 * to undo captures so the player's inventory is byte-identical to its
 * pre-export state.
 *
 * Best-effort: failures on individual slot acks don't abort the rest of
 * the restore.
 */
export async function restoreInventoryToSnapshot(
    ctx: TaskContext,
    snapshot: InventorySnapshot
): Promise<void> {
    const inv = Player.getInventory();
    if (inv === null || inv === undefined) return;

    for (const entry of snapshot) {
        const current = inv.getStackInSlot(entry.slotId);
        // Read current state with the SAME canonical SNBT path the
        // snapshot used. Using `getRawNBT()` here would compare against
        // 1.8.9's debugging `[0:val,1:val]` format, which never matches
        // the canonical SNBT in `entry.nbt` — so every non-empty slot
        // would get "restored" unnecessarily on every export.
        const currentNbt =
            current === null || current === undefined
                ? null
                : snbtFromItem(current, { pretty: false });
        const currentCount = getStackCount(current);

        if (currentNbt === entry.nbt && currentCount === entry.count) continue;

        // C10PacketCreativeInventoryAction slot ids: hotbar 0..8 are
        // packet slots 36..44; main-inv 9..35 are packet 9..35.
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
            `restoring inventory slot ${entry.slotId} after capture`
        );
        try {
            await ctx.withTimeout(
                waitForAnySetSlot(ctx),
                `restore slot ${entry.slotId} ack`,
                SET_SLOT_ACK_TIMEOUT_MS
            );
        } catch (_error) {
            // Keep restoring — individual ack failures are non-fatal.
        }
    }
}
