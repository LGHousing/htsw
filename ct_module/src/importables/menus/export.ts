import type { ImportableMenu, MenuSlot } from "htsw/types";

import { readActionList } from "../../importer/actions";
import {
    clickGoBack,
    readCurrentValue,
    readSelectedOption,
    waitForMenu,
} from "../../importer/helpers";
import { getCurrentHousingUuid, writeKnowledge } from "../../knowledge";
import TaskContext from "../../tasks/context";
import { getAllItemSlots } from "../../tasks/specifics/slots";
import { removedFormatting } from "../../utils/helpers";
import { observedSlotsToActions } from "../../exporter/sanitize";
import { upsertImportableEntry } from "../../exporter/importJsonWriter";
import { canonicalSlug } from "../../exporter/paths";
import { openMenuEditor } from "./shared";

export type ExportMenuOptions = {
    /** The menu name as known to Hypixel Housing. */
    name: string;
    /** Path to the `import.json` to upsert into (will be created if absent). */
    importJsonPath: string;
    /**
     * Root directory the export is being written under. Per-slot SNBT
     * files are written to `<rootDir>/menus/<slug>/slot-<N>.snbt` and
     * referenced from `import.json` via the relative path
     * `"menus/<slug>/slot-<N>.snbt"`: same convention items use.
     */
    rootDir: string;
};

const SIZE_OPTIONS = ["1", "2", "3", "4", "5", "6"];

/**
 * Read the current size (lines, 1..6) from the "Change Size" slot.
 * Tries `readSelectedOption` first (cycle-style display), falls back to
 * `readCurrentValue` for slots that show "Current Value: 3".
 *
 * Returns `undefined` if the slot can't be parsed: the caller treats
 * that as "size unknown" and omits it from the exported menu.
 */
function readMenuSize(ctx: TaskContext): number | undefined {
    const slot = ctx.tryGetItemSlot("Change Size");
    if (slot === null) return undefined;

    const selected = readSelectedOption(slot, SIZE_OPTIONS);
    if (selected !== null) {
        const n = Number(selected);
        if (Number.isInteger(n) && n >= 1 && n <= 6) return n;
    }

    const current = readCurrentValue(slot);
    if (current !== null) {
        const stripped = removedFormatting(current).trim();
        // Tolerate "3", "3 lines", "3 line", etc.
        const match = stripped.match(/^(\d+)/);
        if (match !== null) {
            const n = Number(match[1]);
            if (Number.isInteger(n) && n >= 1 && n <= 6) return n;
        }
    }

    return undefined;
}

/**
 * Snapshot every populated grid slot before navigating into any of them.
 * Returns `(slotId, snbt)` pairs sorted by slot id.
 *
 * Filters out anything past the menu grid (the bottom 36 player inventory
 * slots) and any slot whose item is air.
 */
function snapshotMenuSlots(
    menuSlotCount: number
): Array<{ slotId: number; snbt: string }> {
    const all = getAllItemSlots();
    if (all === null) {
        throw new Error("No open container while snapshotting menu slots.");
    }

    const result: Array<{ slotId: number; snbt: string }> = [];
    for (const itemSlot of all) {
        const slotId = itemSlot.getSlotId();
        if (slotId >= menuSlotCount) continue;

        const snbt = itemSlot.getItem().getRawNBT();
        if (typeof snbt !== "string" || snbt.length === 0) continue;

        result.push({ slotId, snbt });
    }
    result.sort((a, b) => a.slotId - b.slotId);
    return result;
}

/**
 * High-level export-a-menu flow. v1 writes per-slot SNBT files plus an
 * `import.json` upsert; HTSL serialization is skipped because no menu
 * syntax exists in the printer yet.
 */
export async function exportMenu(
    ctx: TaskContext,
    options: ExportMenuOptions
): Promise<void> {
    const { name, importJsonPath, rootDir } = options;

    if ((await openMenuEditor(ctx, name)) === "missing") {
        throw new Error(`No menu named "${name}" exists in this housing.`);
    }

    const size = readMenuSize(ctx);
    // If we can't read size, default to 6 lines for the snapshot scan so
    // we don't accidentally truncate the grid; the exported menu just
    // omits the `size` field and Housing's default applies on re-import.
    const gridSize = (size ?? 6) * 9;

    const snapshot = snapshotMenuSlots(gridSize);

    // Now visit each populated slot to read its action list. We snapshot
    // first so this loop's navigation doesn't invalidate slot positions.
    const slug = canonicalSlug(name);
    const menuRel = `menus/${slug}`;
    const menuAbs = `${rootDir}/${menuRel}`;
    const slots: MenuSlot[] = [];

    for (const { slotId, snbt } of snapshot) {
        const snbtRel = `${menuRel}/slot-${slotId}.snbt`;
        const snbtAbs = `${menuAbs}/slot-${slotId}.snbt`;
        FileLib.write(snbtAbs, snbt, true);

        // Left-click the slot to open its per-slot editor.
        const container = Player.getContainer();
        if (container == null) {
            throw new Error(
                "No open container while reading menu slot " + slotId
            );
        }
        container.click(slotId, false, "LEFT");
        await waitForMenu(ctx);

        let slotActions: import("htsw/types").Action[] = [];
        const editActionsSlot = ctx.tryGetItemSlot("Edit Actions");
        if (editActionsSlot !== null) {
            editActionsSlot.click();
            await waitForMenu(ctx);

            const observed = await readActionList(ctx, { kind: "full" });
            slotActions = observedSlotsToActions(observed);

            await clickGoBack(ctx); // back to per-slot editor
        }

        await clickGoBack(ctx); // back to menu grid

        slots.push({
            slot: slotId,
            // The parser's `parseNbt` accepts the relative SNBT path; the
            // type expects a `Tag` but at the import.json level we ship a
            // string and the parser resolves it. The exporter therefore
            // emits the path string and we sidestep the type by casting
            // through `unknown`: this matches how items are exported
            // (they ship the same SNBT-path string in import.json).
            nbt: snbtRel as unknown as MenuSlot["nbt"],
            ...(slotActions.length > 0 ? { actions: slotActions } : {}),
        });
    }

    const importable: ImportableMenu = {
        type: "MENU",
        name,
        ...(size !== undefined ? { size } : {}),
        slots,
    };

    upsertImportableEntry(importJsonPath, "menus", {
        name,
        ...(size !== undefined ? { size } : {}),
        slots: slots.map((s) => ({
            slot: s.slot,
            nbt: s.nbt as unknown as string,
            ...(s.actions !== undefined && s.actions.length > 0
                ? { actions: s.actions }
                : {}),
        })),
    });

    try {
        const housingUuid = await getCurrentHousingUuid(ctx);
        writeKnowledge(ctx, housingUuid, importable, "exporter");
    } catch (error) {
        ctx.displayMessage(`&7[export] &eCache write skipped: ${error}`);
    }

    ctx.displayMessage(
        `&aExported menu '${name}' (${slots.length} slot${slots.length === 1 ? "" : "s"})`
    );
    ctx.displayMessage(`&7  -> ${importJsonPath}`);
    if (slots.length > 0) {
        ctx.displayMessage(`&7  -> ${menuAbs}/slot-*.snbt`);
    }
}
