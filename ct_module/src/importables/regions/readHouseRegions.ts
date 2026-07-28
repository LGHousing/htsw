import type { Action, ImportableRegion } from "htsw/types";
import * as htsw from "htsw";

import { readActionListFully } from "../../housingSync/actions/hydration/run";
import { ItemCaptureRegistry } from "../items/captureRegistry";
import type { ProgressHandler } from "../../housingSync/progress/types";
import type { SyncEventHandler } from "../../housingSync/syncEvents";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import { shallowActionListHasActions } from "../../housingSync/fields/loreParsing";
import { tryWriteImportableCache } from "../../importCache";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { ensureParentDirs } from "../../utils/filesystem";
import {
    htslTargetsForRegionExport,
    regionExportReferencesExist,
    type HtslExportTarget,
} from "../../project/paths";
import TaskContext from "../../tasks/context";
import { defineHouseExporter } from "../export/exporter";
import { listAllRegions, type RegionListEntry } from "./listRegions";
import { openRegionEditor } from "./housing";

function requireRegionBounds(entry: RegionListEntry): ImportableRegion["bounds"] {
    if (entry.bounds === null) {
        throw new Error(`Region "${entry.name}" did not expose bounds in /regions.`);
    }
    return entry.bounds;
}

async function readRegionActionList(
    ctx: TaskContext,
    regionName: string,
    slotName: "Entry Actions" | "Exit Actions",
    itemCaptures: ItemCaptureRegistry,
    onReadProgress?: ProgressHandler,
    events?: SyncEventHandler
): Promise<Action[] | undefined> {
    if ((await openRegionEditor(ctx, regionName)) === "missing") {
        throw new Error(`No region named "${regionName}" exists in this housing.`);
    }

    const slot = ctx.getItemSlot(slotName);
    if (!shallowActionListHasActions(slot)) return undefined;

    slot.click();
    await timedWaitForMenu(ctx, "menuClickWait");
    const actions = await readActionListFully(ctx, {
        itemReadMode: "export",
        itemCaptures,
        events,
        ...(onReadProgress !== undefined
            ? {
                  progress: onReadProgress,
                  phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
              }
            : {}),
    });
    return actions.length === 0 ? undefined : actions;
}

function writeActionFile(
    ctx: TaskContext,
    target: HtslExportTarget,
    actions: readonly Action[]
): void {
    const { source, diagnostics } = htsw.htsl.printActionsWithDiagnostics(actions);
    for (const diag of diagnostics) {
        ctx.displayMessage(`&7[export] &e${diag.message}`);
    }
    ensureParentDirs(target.htslPath);
    FileLib.write(target.htslPath, source, true);
    ctx.displayMessage(`&7  -> ${target.htslPath}`);
}

async function readRegion(
    ctx: TaskContext,
    entry: RegionListEntry,
    itemCaptures: ItemCaptureRegistry,
    onReadProgress?: ProgressHandler,
    events?: SyncEventHandler
): Promise<ImportableRegion> {
    const bounds = requireRegionBounds(entry);
    const enterActions = await readRegionActionList(
        ctx,
        entry.name,
        "Entry Actions",
        itemCaptures,
        onReadProgress,
        events
    );
    ctx.checkCancelled();
    const exitActions = await readRegionActionList(
        ctx,
        entry.name,
        "Exit Actions",
        itemCaptures,
        onReadProgress,
        events
    );

    const importable: ImportableRegion = {
        type: "REGION",
        name: entry.name,
        bounds,
        ...(enterActions !== undefined ? { onEnterActions: enterActions } : {}),
        ...(exitActions !== undefined ? { onExitActions: exitActions } : {}),
    };

    return importable;
}

async function writeRegionResult(
    ctx: TaskContext,
    importable: ImportableRegion,
    declaringJsonPath: string,
    onEnterTarget: HtslExportTarget,
    onExitTarget: HtslExportTarget
): Promise<void> {
    if (importable.onEnterActions !== undefined) {
        ctx.checkCancelled();
        writeActionFile(ctx, onEnterTarget, importable.onEnterActions);
    }
    if (importable.onExitActions !== undefined) {
        ctx.checkCancelled();
        writeActionFile(ctx, onExitTarget, importable.onExitActions);
    }

    upsertImportableEntry(declaringJsonPath, "regions", {
        name: importable.name,
        bounds: importable.bounds,
        ...(importable.onEnterActions !== undefined
            ? { onEnterActions: onEnterTarget.htslReference }
            : {}),
        ...(importable.onExitActions !== undefined
            ? { onExitActions: onExitTarget.htslReference }
            : {}),
    });

    await tryWriteImportableCache(ctx, importable, "exporter");

    const actionCount =
        (importable.onEnterActions?.length ?? 0) +
        (importable.onExitActions?.length ?? 0);
    ctx.displayMessage(
        `&aExported region '${importable.name}' (${actionCount} action${actionCount === 1 ? "" : "s"})`
    );
}

// Regions carry Entry/Exit action lists (and the items those actions reference),
// so this reads through the region editor and captures items via the inventory.
// Entry-based: the bounds come from the /regions listing, so the batch always
// lists even for a selection.
export const readRegions = defineHouseExporter({
    type: "REGION",
    noun: "region",
    list: listAllRegions,
    nameOf: (entry) => entry.name,
    alwaysList: true,
    capturesActionItems: true,
    referencesExist: regionExportReferencesExist,
    exportSummary: (state) => {
        const counts = state.itemCaptures.counts();
        return ` (items: ${counts.matched} matched, ${counts.fresh} new)`;
    },
    reader: {
        kind: "direct",
        read: (ctx, entry, options, state, onReadProgress) =>
            readRegion(ctx, entry, state.itemCaptures, onReadProgress, options.progress?.events),
    },
    importableOf: (importable) => importable,
    export: async (ctx, entry, importable, options) => {
        const target = htslTargetsForRegionExport(
            options.importJsonPath,
            entry.name,
            options.newExportTargetImportJson
        );
        await writeRegionResult(
            ctx,
            importable,
            target.importJsonPath,
            target.onEnter,
            target.onExit
        );
    },
});
