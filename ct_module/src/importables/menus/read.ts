import type { Action } from "htsw/types";
import * as htsw from "htsw";

import { readActionList } from "../../housingSync/actions/readList";
import type { ProgressHandler } from "../../housingSync/progress/types";
import { clickGoBack } from "../../housingSync/gui/menuUtils";
import { waitForMenu } from "../../housingSync/gui/menuWait";
import TaskContext from "../../tasks/context";
import { getAllItemSlots } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import { observedSlotsToActions } from "../../exporter/sanitize";
import { snbtFromItem } from "../../housingSync/itemCapture";
import { openMenuElements } from "./shared";

const PLAYER_INVENTORY_SLOTS = 36;

export type LiveMenuSlot = {
    slot: number;
    snbt: string;
    actions: Action[];
    /** Cleaned display-name hint for naming a deduped item file. */
    nameHint: string;
};

// Housing appends this editor footer to every grid item's lore. It's display
// state, not part of the item, so it's stripped to recover the real item (and
// so identical items across slots dedupe to one file).
const FOOTER_LORE_LINES = 3;

/**
 * Strip the trailing editor-footer lore lines Housing adds to a grid item,
 * yielding the clean underlying item SNBT. Tolerant: returns the input
 * unchanged if it can't parse or has no lore to trim.
 */
function stripMenuItemFooter(snbt: string): string {
    try {
        const tag = htsw.nbt.parseSnbtText(snbt);
        if (tag.type !== "compound") return snbt;
        const tagNode = tag.value["tag"];
        if (tagNode === undefined || tagNode.type !== "compound") return snbt;
        const display = tagNode.value["display"];
        if (display === undefined || display.type !== "compound") return snbt;
        const lore = display.value["Lore"];
        if (lore === undefined || lore.type !== "list") return snbt;

        const keep = Math.max(0, lore.value.value.length - FOOTER_LORE_LINES);
        lore.value.value = lore.value.value.slice(0, keep);
        if (lore.value.value.length === 0) {
            delete display.value["Lore"];
        }
        return htsw.nbt.printSnbt(tag, { pretty: false });
    } catch (_e) {
        return snbt;
    }
}
export type LiveMenu = {
    size: number | undefined;
    gridSize: number;
    slots: LiveMenuSlot[];
};

// Housing fills every empty grid slot with a filler: a gray stained_glass_pane
// named "Empty Slot" whose first lore line is "Click to set item!". These are
// not real menu items and must be skipped.
const EMPTY_SLOT_LORE = "Click to set item!";

function isEmptySlotFiller(item: Item): boolean {
    for (const line of item.getLore()) {
        if (removedFormatting(line).trim() === EMPTY_SLOT_LORE) return true;
    }
    return false;
}

/**
 * Snapshot every real grid slot's raw NBT before navigating into any of them.
 * Returns `(slotId, snbt)` pairs sorted by slot id, skipping the trailing 36
 * player-inventory slots, air, and Housing's "Empty Slot" fillers.
 *
 * Must be called on the "Edit Elements" grid (after `openMenuElements`), not
 * the settings screen.
 */
export function snapshotMenuSlots(
    menuSlotCount: number
): Array<{ slotId: number; snbt: string; nameHint: string }> {
    const all = getAllItemSlots();
    if (all === null) {
        throw new Error("No open container while snapshotting menu slots.");
    }

    const result: Array<{ slotId: number; snbt: string; nameHint: string }> = [];
    for (const itemSlot of all) {
        const slotId = itemSlot.getSlotId();
        if (slotId >= menuSlotCount) continue;

        const item = itemSlot.getItem();
        if (item === null || item === undefined) continue;
        if (isEmptySlotFiller(item)) continue;

        // Build SNBT from the item's Tag (not getRawNBT) so it's valid htsw
        // SNBT that pretty-prints; getRawNBT's MC format doesn't reparse. Strip
        // Housing's editor footer to recover the real, dedupe-able item.
        const raw = snbtFromItem(item, { pretty: false });
        if (typeof raw !== "string" || raw.length === 0) continue;
        const snbt = stripMenuItemFooter(raw);

        const nameHint = removedFormatting(item.getName())
            .replace(/\s*\(#[^)]*\)\s*$/, "")
            .trim();

        result.push({ slotId, snbt, nameHint });
    }
    result.sort((a, b) => a.slotId - b.slotId);
    return result;
}

/**
 * Read a single grid slot's click-action list. Assumes the "Edit Elements"
 * grid is open: LEFT-clicking a populated slot opens its action editor
 * directly (right-click changes the item instead). Reads the list and returns
 * to the grid. Returns an empty list when the slot has no actions.
 */
export async function readMenuSlotActions(
    ctx: TaskContext,
    slotId: number
): Promise<Action[]> {
    const container = Player.getContainer();
    if (container == null) {
        throw new Error("No open container while reading menu slot " + slotId);
    }
    container.click(slotId, false, "LEFT");
    await waitForMenu(ctx);
    ctx.getItemSlot("Edit Actions").click();
    await waitForMenu(ctx);

    const observed = await readActionList(ctx, { kind: "full" });
    const actions = observedSlotsToActions(observed);

    await clickGoBack(ctx);
    await clickGoBack(ctx);
    return actions;
}

/**
 * Read the full live state of an already-open menu: size, grid size, and every
 * populated slot's item NBT + action list. The single live-menu read shared by
 * export and the import preread. Caller must have the menu editor open.
 */
export async function readLiveMenu(
    ctx: TaskContext,
    onReadProgress?: ProgressHandler
): Promise<LiveMenu> {
    // Enter the actual slot grid (behind "Edit Menu Elements"). The grid
    // container's own slot count IS the menu size — `rows * 9` plus the 36
    // trailing player-inventory slots — so size needs no settings-screen read.
    await openMenuElements(ctx);

    const container = Player.getContainer();
    if (container == null) {
        throw new Error("No open container after opening menu elements.");
    }
    const gridSize = container.getSize() - PLAYER_INVENTORY_SLOTS;
    const size = gridSize > 0 && gridSize % 9 === 0 ? gridSize / 9 : undefined;

    const snapshot = snapshotMenuSlots(gridSize);

    // Slot-level progress: a menu read is one editor round-trip per populated
    // slot, so slots-done/slots-total is the honest granularity (per-slot
    // action lists are usually tiny).
    const emitSlotProgress = (done: number): void => {
        if (onReadProgress === undefined || snapshot.length === 0) return;
        onReadProgress({
            phase: "reading",
            completedUnits: done,
            totalUnits: snapshot.length,
            phaseUnits: { setup: 0, reading: snapshot.length, hydrating: 0, applying: 0 },
            sync: { completedUnits: done, totalUnits: snapshot.length, parent: null },
        });
    };

    const slots: LiveMenuSlot[] = [];
    emitSlotProgress(0);
    for (const { slotId, snbt, nameHint } of snapshot) {
        const actions = await readMenuSlotActions(ctx, slotId);
        slots.push({ slot: slotId, snbt, actions, nameHint });
        emitSlotProgress(slots.length);
    }

    return { size, gridSize, slots };
}
