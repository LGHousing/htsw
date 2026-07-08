import type { ImportableMenu, MenuSlot } from "htsw/types";
import * as htsw from "htsw";

import { getCurrentHousingUuid, writeImportableCache } from "../../importCache";
import type { ProgressHandler } from "../../housingSync/progress/types";
import { ItemCaptureRegistry, prettySnbt } from "../../housingSync/itemCapture";
import TaskContext from "../../tasks/context";
import { ensureParentDirs } from "../../utils/filesystem";
import { resolveImportableFile, upsertImportableEntry } from "../../project/importJsonMutations";
import { canonicalSlug, parentDirOf, sectionFolderImportJson } from "../../project/paths";
import { menuExportReferencesExist } from "../../project/paths";
import { makeReadHouse } from "../readHouse";
import { listAllMenuNames } from "./listMenus";
import { readLiveMenu } from "./read";
import { openMenuEditor } from "./shared";

type ExportMenuOptions = {
    /** The menu name as known to Hypixel Housing. */
    name: string;
    /** Path to the `import.json` to upsert into (will be created if absent). */
    importJsonPath: string;
    /**
     * Root directory the export is being written under. Per-slot `.htsl` files
     * go to `<rootDir>/menus/<slug>/slot-<N>.htsl` (just `<rootDir>/<slug>/`
     * when the destination is the menus section folder itself); deduped slot
     * items go to `<rootDir>/items/<name>.snbt`.
     */
    rootDir: string;
    onReadProgress?: ProgressHandler;
    // Read-only (deep read): cache the menu, write no files.
    readOnly?: { housingUuid: string };
};

/**
 * When exporting many menus, the caller shares one registry (so identical items
 * across menus collapse to one file) and one `writtenItems` set (so each shared
 * item file is written exactly once across the whole batch).
 */
type ExportMenuSharedState = {
    itemCaptures: ItemCaptureRegistry;
    writtenItems: Set<string>;
};

type ImportJsonMenuSlot = { slot: number; nbt: string; actions?: string };

function pathKeyOf(path: string): string {
    return path.split("\\").join("/").toLowerCase();
}

/**
 * Export one menu: each slot's item is deduped into a shared `items/<name>.snbt`
 * and its click-actions written to a `.htsl`, both referenced by path in the
 * `import.json` (the language requires string paths, like functions/events).
 */
async function exportMenu(
    ctx: TaskContext,
    options: ExportMenuOptions,
    shared: ExportMenuSharedState
): Promise<void> {
    const { name } = options;
    const { itemCaptures, writtenItems } = shared;

    // A menu already declared in an INCLUDED file updates in place: the
    // entry is upserted into its declaring import.json, and since every
    // slot ref is relative to the file declaring it, the slot htsl/snbt
    // files move under that file's folder too. A NEW menu goes to the
    // project's menus/import.json when that section folder is included.
    const sectionJson = sectionFolderImportJson(options.importJsonPath, "menus");
    const declared = resolveImportableFile(options.importJsonPath, "menus", name);
    const importJsonPath =
        declared !== options.importJsonPath ? declared : (sectionJson ?? options.importJsonPath);
    const rootDir =
        importJsonPath === options.importJsonPath ? options.rootDir : parentDirOf(importJsonPath);
    // Inside the menus section folder the per-menu folder sits directly
    // beside its import.json — a "menus/" prefix there would nest menus/menus/.
    const inSectionFolder =
        sectionJson !== null && pathKeyOf(importJsonPath) === pathKeyOf(sectionJson);

    if ((await openMenuEditor(ctx, name)) === "missing") {
        throw new Error(`No menu named "${name}" exists in this housing.`);
    }

    const live = await readLiveMenu(ctx, options.onReadProgress);

    const slug = canonicalSlug(name);
    const menuRel = inSectionFolder ? slug : `menus/${slug}`;
    const menuAbs = `${rootDir}/${menuRel}`;

    const jsonSlots: ImportJsonMenuSlot[] = [];
    const cacheSlots: MenuSlot[] = [];

    for (const liveSlot of live.slots) {
        // Cache slots in the same parsed-Tag form the import.json loader
        // produces, so the drift hash compares like with like.
        cacheSlots.push({
            slot: liveSlot.slot,
            nbt: htsw.nbt.parseSnbtText(liveSlot.snbt) as MenuSlot["nbt"],
            ...(liveSlot.actions.length > 0 ? { actions: liveSlot.actions } : {}),
        });
        // Read-only (deep read) records the live menu in the cache but writes no
        // item/.htsl/import.json files.
        if (options.readOnly !== undefined) continue;

        // Item: deduped by content into a shared items/<name>.snbt, written
        // before the json references it so the reference is never dangling.
        const itemName = itemCaptures.register(liveSlot.snbt, liveSlot.nameHint);
        const nbtRel = `items/${itemName}.snbt`;
        // Keyed by absolute path, not item name: menus in one batch can be
        // declared in different files, and each base dir needs its own copy
        // for the relative ref to resolve.
        const itemAbs = `${rootDir}/${nbtRel}`;
        if (!writtenItems.has(itemAbs)) {
            ensureParentDirs(itemAbs);
            FileLib.write(itemAbs, prettySnbt(liveSlot.snbt), true);
            writtenItems.add(itemAbs);
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
    }

    const importable: ImportableMenu = {
        type: "MENU",
        name,
        ...(live.size !== undefined ? { size: live.size } : {}),
        slots: cacheSlots,
    };

    if (options.readOnly !== undefined) {
        writeImportableCache(ctx, options.readOnly.housingUuid, importable, "reader", true);
        ctx.displayMessage(
            `&aRead menu '${name}' (${cacheSlots.length} slot${cacheSlots.length === 1 ? "" : "s"})`
        );
        return;
    }

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

// Menus read each slot's item NBT straight off the live menu, so unlike the
// action-list types they don't pull items through the inventory — no snapshot,
// no batch item flush. Each slot item is deduped and written inline instead.
export const readMenus = makeReadHouse<string>({
    type: "MENU",
    noun: "menu",
    list: listAllMenuNames,
    referencesExist: menuExportReferencesExist,
    exportSummary: (state) => {
        const count = state.itemCaptures.size();
        return ` (${count} unique item${count === 1 ? "" : "s"})`;
    },
    readOne: (ctx, name, options, state, onReadProgress) =>
        exportMenu(
            ctx,
            {
                name,
                importJsonPath: options.importJsonPath,
                rootDir: options.rootDir,
                readOnly: options.readOnly,
                onReadProgress,
            },
            { itemCaptures: state.itemCaptures, writtenItems: state.writtenItems }
        ),
});
