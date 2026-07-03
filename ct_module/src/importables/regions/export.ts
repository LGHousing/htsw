import type { Action, ImportableRegion } from "htsw/types";
import * as htsw from "htsw";

import { readActionList } from "../../housingSync/actions/readList";
import {
    ItemCaptureRegistry,
    type InventorySnapshot,
} from "../../housingSync/itemCapture";
import type { ProgressHandler } from "../../housingSync/progress/types";
import { timedWaitForMenu } from "../../housingSync/menus/menuWait";
import { shallowActionListHasActions } from "../../housingSync/fields/loreParsing";
import { tryWriteImportableCache, writeImportableCache } from "../../importCache";
import { observedSlotsToActions } from "../../housingSync/observedActions";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { ensureParentDirs } from "../../utils/filesystem";
import type { HtslExportTarget } from "../../project/paths";
import TaskContext from "../../tasks/context";
import type { RegionListEntry } from "./listRegions";
import { openRegionEditor } from "./shared";

export type ExportRegionWithSharedStateOptions = {
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

export type SharedRegionExportState = {
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
    const observed = await readActionList(ctx, { kind: "deep" }, {
        itemCaptures,
        ...(onReadProgress !== undefined
            ? {
                  progress: onReadProgress,
                  phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
              }
            : {}),
    });
    const actions = observedSlotsToActions(observed);
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

export async function exportRegionWithSharedState(
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
        writeImportableCache(ctx, options.readOnly.housingUuid, importable, "reader", true);
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
