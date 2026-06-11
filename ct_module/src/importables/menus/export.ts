import type { ImportableMenu, MenuSlot } from "htsw/types";
import * as htsw from "htsw";

import { getCurrentHousingUuid, writeImportableCache } from "../../importCache";
import type { ProgressHandler } from "../../housingSync/progress/types";
import { ItemCaptureRegistry, prettySnbt } from "../../housingSync/itemCapture";
import TaskContext from "../../tasks/context";
import { ensureParentDirs } from "../../utils/filesystem";
import { upsertImportableEntry } from "../../exporter/importJsonWriter";
import { canonicalSlug } from "../../exporter/paths";
import { readLiveMenu } from "./read";
import { openMenuEditor } from "./shared";

export type ExportMenuOptions = {
    /** The menu name as known to Hypixel Housing. */
    name: string;
    /** Path to the `import.json` to upsert into (will be created if absent). */
    importJsonPath: string;
    /**
     * Root directory the export is being written under. Per-slot `.htsl` files
     * go to `<rootDir>/menus/<slug>/slot-<N>.htsl`; deduped slot items go to
     * `<rootDir>/items/<name>.snbt`.
     */
    rootDir: string;
    onReadProgress?: ProgressHandler;
};

/**
 * When exporting many menus, the caller shares one registry (so identical items
 * across menus collapse to one file) and one `writtenItems` set (so each shared
 * item file is written exactly once across the whole batch).
 */
export type ExportMenuSharedState = {
    itemCaptures: ItemCaptureRegistry;
    writtenItems: Set<string>;
};

type ImportJsonMenuSlot = { slot: number; nbt: string; actions?: string };

/**
 * Export one menu: each slot's item is deduped into a shared `items/<name>.snbt`
 * and its click-actions written to a `.htsl`, both referenced by path in the
 * `import.json` (the language requires string paths, like functions/events).
 */
export async function exportMenu(
    ctx: TaskContext,
    options: ExportMenuOptions,
    shared?: ExportMenuSharedState
): Promise<void> {
    const { name, importJsonPath, rootDir } = options;
    const itemCaptures = shared?.itemCaptures ?? new ItemCaptureRegistry();
    const writtenItems = shared?.writtenItems ?? new Set<string>();

    if ((await openMenuEditor(ctx, name)) === "missing") {
        throw new Error(`No menu named "${name}" exists in this housing.`);
    }

    const live = await readLiveMenu(ctx, options.onReadProgress);

    const slug = canonicalSlug(name);
    const menuRel = `menus/${slug}`;
    const menuAbs = `${rootDir}/${menuRel}`;

    const jsonSlots: ImportJsonMenuSlot[] = [];
    const cacheSlots: MenuSlot[] = [];

    for (const liveSlot of live.slots) {
        // Item: deduped by content into a shared items/<name>.snbt, written
        // before the json references it so the reference is never dangling.
        const itemName = itemCaptures.register(liveSlot.snbt, liveSlot.nameHint);
        const nbtRel = `items/${itemName}.snbt`;
        if (!writtenItems.has(itemName)) {
            const itemAbs = `${rootDir}/${nbtRel}`;
            ensureParentDirs(itemAbs);
            FileLib.write(itemAbs, prettySnbt(liveSlot.snbt), true);
            writtenItems.add(itemName);
        }

        // Actions: per-slot .htsl under the menu folder.
        let actionsRel: string | undefined;
        if (liveSlot.actions.length > 0) {
            const htslRel = `${menuRel}/slot-${liveSlot.slot}.htsl`;
            const htslAbs = `${menuAbs}/slot-${liveSlot.slot}.htsl`;
            const { source, diagnostics } = htsw.htsl.printActionsWithDiagnostics(
                liveSlot.actions
            );
            for (const diag of diagnostics) {
                ctx.displayMessage(`&7[export] &e${diag.message}`);
            }
            ensureParentDirs(htslAbs);
            FileLib.write(htslAbs, source, true);
            actionsRel = htslRel;
        }

        jsonSlots.push({
            slot: liveSlot.slot,
            nbt: nbtRel,
            ...(actionsRel !== undefined ? { actions: actionsRel } : {}),
        });
        cacheSlots.push({
            slot: liveSlot.slot,
            nbt: liveSlot.snbt as unknown as MenuSlot["nbt"],
            ...(liveSlot.actions.length > 0 ? { actions: liveSlot.actions } : {}),
        });
    }

    const importable: ImportableMenu = {
        type: "MENU",
        name,
        ...(live.size !== undefined ? { size: live.size } : {}),
        slots: cacheSlots,
    };

    // All referenced item files are already on disk (written in the loop above),
    // so upserting the menu entry now never produces a dangling reference.
    upsertImportableEntry(importJsonPath, "menus", {
        name,
        ...(live.size !== undefined ? { size: live.size } : {}),
        slots: jsonSlots,
    });

    try {
        const housingUuid = await getCurrentHousingUuid(ctx);
        writeImportableCache(ctx, housingUuid, importable, "exporter");
    } catch (error) {
        ctx.displayMessage(`&7[export] &eCache write skipped: ${error}`);
    }

    const withActions = jsonSlots.filter((s) => s.actions !== undefined).length;
    ctx.displayMessage(
        `&aExported menu '${name}' (${jsonSlots.length} slot${jsonSlots.length === 1 ? "" : "s"}, ${withActions} with actions)`
    );
    ctx.displayMessage(`&7  -> ${importJsonPath}`);
}
