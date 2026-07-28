import type { ImportableMenu, MenuSlot } from "htsw/types";
import * as htsw from "htsw";

import { tryWriteImportableCache } from "../../importCache";
import type { ProgressHandler } from "../../housingSync/progress/types";
import type { SyncEventHandler } from "../../housingSync/syncEvents";
import { prettySnbt } from "../../housingSync/items/itemNbt";
import { ItemCaptureRegistry } from "../items/captureRegistry";
import TaskContext from "../../tasks/context";
import { ensureParentDirs } from "../../utils/filesystem";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import {
    canonicalSlug,
    importJsonTargetForSectionEntry,
    parentDirOf,
    sectionFolderImportJson,
} from "../../project/paths";
import { menuExportReferencesExist } from "../../project/paths";
import { defineHouseExporter } from "../export/exporter";
import { listAllMenuNames } from "./listMenus";
import { readLiveMenu, type LiveMenu } from "./read";
import { openMenuEditor } from "./housing";

type ExportMenuSharedState = {
    slotItemCaptures: ItemCaptureRegistry;
    writtenItems: Set<string>;
};

type ImportJsonMenuSlot = { slot: number; nbt: string; actions?: string };

type MenuReadResult = {
    importable: ImportableMenu;
    live: LiveMenu;
};

function pathKeyOf(path: string): string {
    return path.split("\\").join("/").toLowerCase();
}

async function readMenu(
    ctx: TaskContext,
    name: string,
    actionItemCaptures: ItemCaptureRegistry,
    onReadProgress?: ProgressHandler,
    events?: SyncEventHandler
): Promise<MenuReadResult> {
    if ((await openMenuEditor(ctx, name)) === "missing") {
        throw new Error(`No menu named "${name}" exists in this housing.`);
    }

    const live = await readLiveMenu(
        ctx,
        {
            itemReadMode: "export",
            itemCaptures: actionItemCaptures,
        },
        onReadProgress,
        events
    );
    const cacheSlots: MenuSlot[] = [];
    for (const liveSlot of live.slots) {
        cacheSlots.push({
            slot: liveSlot.slot,
            nbt: htsw.nbt.parseSnbtText(liveSlot.snbt),
            ...(liveSlot.actions.length > 0 ? { actions: liveSlot.actions } : {}),
        });
    }

    return {
        importable: {
            type: "MENU",
            name,
            ...(live.size !== undefined ? { size: live.size } : {}),
            slots: cacheSlots,
        },
        live,
    };
}

async function writeMenuResult(
    ctx: TaskContext,
    result: MenuReadResult,
    baseImportJsonPath: string,
    importJsonPath: string,
    rootDir: string,
    shared: ExportMenuSharedState
): Promise<void> {
    const { importable, live } = result;
    const { slotItemCaptures, writtenItems } = shared;
    const sectionJson = sectionFolderImportJson(baseImportJsonPath, "menus");
    const inSectionFolder =
        sectionJson !== null && pathKeyOf(importJsonPath) === pathKeyOf(sectionJson);
    const slug = canonicalSlug(importable.name);
    const menuRel = inSectionFolder ? slug : `menus/${slug}`;
    const menuAbs = `${rootDir}/${menuRel}`;
    const jsonSlots: ImportJsonMenuSlot[] = [];

    for (const liveSlot of live.slots) {
        const itemName = slotItemCaptures.register(liveSlot.snbt, liveSlot.nameHint);

        const nbtRel = `items/${itemName}.snbt`;
        const itemAbs = `${rootDir}/${nbtRel}`;
        if (!writtenItems.has(itemAbs)) {
            ensureParentDirs(itemAbs);
            FileLib.write(itemAbs, prettySnbt(liveSlot.snbt), true);
            writtenItems.add(itemAbs);
        }

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

    upsertImportableEntry(importJsonPath, "menus", {
        name: importable.name,
        ...(live.size !== undefined ? { size: live.size } : {}),
        slots: jsonSlots,
    });

    await tryWriteImportableCache(ctx, importable, "exporter");

    const withActions = jsonSlots.filter((s) => s.actions !== undefined).length;
    ctx.displayMessage(
        `&aExported menu '${importable.name}' (${jsonSlots.length} slot${jsonSlots.length === 1 ? "" : "s"}, ${withActions} with actions)`
    );
    ctx.displayMessage(`&7  -> ${importJsonPath}`);
}

export const readMenus = defineHouseExporter<string, "MENU", never, MenuReadResult>({
    type: "MENU",
    noun: "menu",
    list: listAllMenuNames,
    referencesExist: menuExportReferencesExist,
    capturesActionItems: true,
    exportSummary: (state) => {
        const count = state.menuSlotItemCaptures.size();
        return ` (${count} unique slot item${count === 1 ? "" : "s"})`;
    },
    reader: {
        kind: "direct",
        read: (ctx, name, options, state, onReadProgress) =>
            readMenu(ctx, name, state.itemCaptures, onReadProgress, options.progress?.events),
    },
    importableOf: (result) => result.importable,
    export: async (ctx, name, result, options, state) => {
        const importJsonPath = importJsonTargetForSectionEntry(
            options.importJsonPath,
            "menus",
            name,
            options.newExportTargetImportJson
        );
        const rootDir =
            importJsonPath === options.importJsonPath
                ? options.rootDir
                : parentDirOf(importJsonPath);
        await writeMenuResult(
            ctx,
            result,
            options.importJsonPath,
            importJsonPath,
            rootDir,
            {
                slotItemCaptures: state.menuSlotItemCaptures,
                writtenItems: state.writtenItems,
            }
        );
    },
});
