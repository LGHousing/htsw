import type { Action } from "htsw/types";
import * as htsw from "htsw";

import { readActionListFully } from "../../housingSync/actions/hydration/run";
import type { ItemReadOptions } from "../../housingSync/context/actionReadContext";
import { COST } from "../../housingSync/progress/costs";
import type { ProgressHandler, ProgressPhase } from "../../housingSync/progress/types";
import { clickGoBack } from "../../housingSync/menus/menuUtils";
import { waitForMenu } from "../../housingSync/menus/menuWait";
import TaskContext from "../../tasks/context";
import { getAllItemSlots } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import { snbtFromItem } from "../../housingSync/items/itemNbt";
import { openMenuElements } from "./shared";

const PLAYER_INVENTORY_SLOTS = 36;

type LiveMenuSlot = {
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
function snapshotMenuSlots(
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
async function readMenuSlotActions(
    ctx: TaskContext,
    slotId: number,
    itemRead: ItemReadOptions,
    onListProgress?: ProgressHandler
): Promise<Action[]> {
    const container = Player.getContainer();
    if (container == null) {
        throw new Error("No open container while reading menu slot " + slotId);
    }
    container.click(slotId, false, "LEFT");
    await waitForMenu(ctx);

    const actions = await readActionListFully(ctx, {
        ...itemRead,
        ...(onListProgress === undefined
            ? {}
            : {
                  progress: onListProgress,
                  phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
              }),
    });

    await clickGoBack(ctx);
    return actions;
}

export type LiveMenuGrid = {
    size: number | undefined;
    gridSize: number;
    slots: Array<{ slot: number; snbt: string; nameHint: string }>;
};

/**
 * Read only the grid: menu size and every populated slot's item NBT, in a
 * single container read, without opening any slot's action editor. This is the
 * cheap half of a menu read — the trusted import uses it to self-heal slot
 * items against the live house while reusing cached action lists, the same way
 * the function trust path reads the live top level and trusts unchanged nested
 * lists. Caller must have the menu editor open.
 */
export async function snapshotLiveMenuGrid(ctx: TaskContext): Promise<LiveMenuGrid> {
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
    return {
        size,
        gridSize,
        slots: snapshot.map((s) => ({
            slot: s.slotId,
            snbt: s.snbt,
            nameHint: s.nameHint,
        })),
    };
}

/**
 * Read the full live state of an already-open menu: size, grid size, and every
 * populated slot's item NBT + action list. The single live-menu read shared by
 * export and the non-trusted import preread. Caller must have the menu editor
 * open.
 */
export async function readLiveMenu(
    ctx: TaskContext,
    itemRead: ItemReadOptions,
    onReadProgress?: ProgressHandler
): Promise<LiveMenu> {
    const grid = await snapshotLiveMenuGrid(ctx);
    const { size, gridSize } = grid;
    const snapshot = grid.slots;

    // Progress is reported in cost-model units (the scale the learned
    // ms/unit rate prices), NOT slots — a slot is a full editor round-trip
    // plus a deep action-list read, so slot counts undercount the work by
    // 10-100x and the ETA reads ~0 while minutes remain. Like the import
    // path, this never predicts: the caller's upfront content-based estimate
    // owns the forecast, and these payloads carry only known work — finished
    // slots at their actual cost, the current slot as its nested read
    // discovers pages/hydration, un-entered slots at the one round trip each
    // is guaranteed to cost. Totals therefore only grow, and only when the
    // walk observes something real.
    const slotRoundTripUnits = COST.menuClickWait + COST.goBackWait;
    let doneReadingUnits = 0;
    let doneHydratingUnits = 0;
    let doneSlots = 0;
    let inSlot = false;
    let currentPhase: ProgressPhase = "reading";
    let currentSlotReadingUnits = 0;
    let currentSlotHydratingUnits = 0;
    let currentSlotCompletedUnits = 0;

    const emitProgress = (): void => {
        if (onReadProgress === undefined || snapshot.length === 0) return;
        const remainingSlots = snapshot.length - doneSlots - (inSlot ? 1 : 0);
        const reading =
            doneReadingUnits +
            currentSlotReadingUnits +
            remainingSlots * slotRoundTripUnits;
        const hydrating = doneHydratingUnits + currentSlotHydratingUnits;
        onReadProgress({
            phase: inSlot ? currentPhase : "reading",
            completedUnits:
                doneReadingUnits + doneHydratingUnits + currentSlotCompletedUnits,
            totalUnits: reading + hydrating,
            phaseUnits: { setup: 0, reading, hydrating, applying: 0 },
            sync: {
                completedUnits: doneSlots,
                totalUnits: snapshot.length,
                parent: null,
            },
        });
    };

    const slots: LiveMenuSlot[] = [];
    emitProgress();
    for (const { slot, snbt, nameHint } of snapshot) {
        inSlot = true;
        currentPhase = "reading";
        currentSlotReadingUnits = slotRoundTripUnits;
        currentSlotHydratingUnits = 0;
        currentSlotCompletedUnits = 0;
        emitProgress();
        const actions = await readMenuSlotActions(
            ctx,
            slot,
            itemRead,
            onReadProgress === undefined
                ? undefined
                : (payload) => {
                      currentPhase = payload.phase;
                      currentSlotReadingUnits =
                          slotRoundTripUnits + payload.phaseUnits.reading;
                      currentSlotHydratingUnits = payload.phaseUnits.hydrating;
                      currentSlotCompletedUnits =
                          COST.menuClickWait + payload.completedUnits;
                      emitProgress();
                  }
        );
        doneReadingUnits += currentSlotReadingUnits;
        doneHydratingUnits += currentSlotHydratingUnits;
        doneSlots++;
        inSlot = false;
        currentSlotReadingUnits = 0;
        currentSlotHydratingUnits = 0;
        currentSlotCompletedUnits = 0;
        slots.push({ slot, snbt, actions, nameHint });
        emitProgress();
    }

    return { size, gridSize, slots };
}
