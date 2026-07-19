import type { Action, ImportableRegion } from "htsw/types";
import * as htsw from "htsw";

import { readActionListFully } from "../../housingSync/actions/hydration/run";
import {
    ItemCaptureRegistry,
    type InventorySnapshot,
} from "../../housingSync/itemCapture";
import type { ProgressHandler } from "../../housingSync/progress/types";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import { shallowActionListHasActions } from "../../housingSync/fields/loreParsing";
import { tryWriteImportableCache, writeImportableCache } from "../../importCache";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { ensureParentDirs } from "../../utils/filesystem";
import {
    htslTargetsForRegionExport,
    regionExportReferencesExist,
    type HtslExportTarget,
} from "../../project/paths";
import TaskContext from "../../tasks/context";
import { makeReadHouse } from "../readHouse";
import { listAllRegions, type RegionListEntry } from "./listRegions";
import { openRegionEditor } from "./shared";

type ExportRegionWithSharedStateOptions = {
    entry: RegionListEntry;
    importJsonPath: string;
    declaringJsonPath: string;
    onEnterTarget: HtslExportTarget;
    onExitTarget: HtslExportTarget;
    rootDir: string;
    onReadProgress?: ProgressHandler;
    // Read-only (deep read): cache the region, write no files.
    readOnly?: { housingUuid: string };
};

type SharedRegionExportState = {
    itemCaptures: ItemCaptureRegistry;
    inventorySnapshot: InventorySnapshot;
};

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
    onReadProgress?: ProgressHandler
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

async function exportRegionWithSharedState(
    ctx: TaskContext,
    options: ExportRegionWithSharedStateOptions,
    shared: SharedRegionExportState
): Promise<void> {
    const bounds = requireRegionBounds(options.entry);
    const enterActions = await readRegionActionList(
        ctx,
        options.entry.name,
        "Entry Actions",
        shared.itemCaptures,
        options.onReadProgress
    );
    ctx.checkCancelled();
    const exitActions = await readRegionActionList(
        ctx,
        options.entry.name,
        "Exit Actions",
        shared.itemCaptures,
        options.onReadProgress
    );

    const importable: ImportableRegion = {
        type: "REGION",
        name: options.entry.name,
        bounds,
        ...(enterActions !== undefined ? { onEnterActions: enterActions } : {}),
        ...(exitActions !== undefined ? { onExitActions: exitActions } : {}),
    };

    if (options.readOnly !== undefined) {
        writeImportableCache(
            ctx,
            options.readOnly.housingUuid,
            importable,
            "reader",
            true
        );
        return;
    }

    if (enterActions !== undefined) {
        ctx.checkCancelled();
        writeActionFile(ctx, options.onEnterTarget, enterActions);
    }
    if (exitActions !== undefined) {
        ctx.checkCancelled();
        writeActionFile(ctx, options.onExitTarget, exitActions);
    }

    upsertImportableEntry(options.declaringJsonPath, "regions", {
        name: options.entry.name,
        bounds,
        ...(enterActions !== undefined
            ? { onEnterActions: options.onEnterTarget.htslReference }
            : {}),
        ...(exitActions !== undefined
            ? { onExitActions: options.onExitTarget.htslReference }
            : {}),
    });

    await tryWriteImportableCache(ctx, importable, "exporter");

    const actionCount = (enterActions?.length ?? 0) + (exitActions?.length ?? 0);
    ctx.displayMessage(
        `&aExported region '${options.entry.name}' (${actionCount} action${actionCount === 1 ? "" : "s"})`
    );
}

// Regions carry Entry/Exit action lists (and the items those actions reference),
// so this reads through the region editor and captures items via the inventory.
// Entry-based: the bounds come from the /regions listing, so the batch always
// lists even for a selection.
export const readRegions = makeReadHouse<RegionListEntry>({
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
    readOne: async (ctx, entry, options, state, onReadProgress) => {
        const target = htslTargetsForRegionExport(
            options.importJsonPath,
            entry.name,
            options.newExportTargetImportJson
        );
        await exportRegionWithSharedState(
            ctx,
            {
                entry,
                importJsonPath: options.importJsonPath,
                declaringJsonPath: target.importJsonPath,
                onEnterTarget: target.onEnter,
                onExitTarget: target.onExit,
                rootDir: options.rootDir,
                readOnly: options.readOnly,
                onReadProgress,
            },
            // capturesActionItems guarantees a non-null snapshot here.
            {
                itemCaptures: state.itemCaptures,
                inventorySnapshot: state.inventorySnapshot!,
            }
        );
    },
});
