import type { Action, ImportableFunction } from "htsw/types";
import * as htsw from "htsw";

import { readActionList } from "../../housingSync/actions/readList";
import { clickGoBack } from "../../housingSync/gui/menuUtils";
import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../../housingSync/itemCapture";
import { tryWriteImportableCache } from "../../importCache";
import TaskContext from "../../tasks/context";
import { observedSlotsToActions } from "../../exporter/sanitize";
import { upsertImportableEntry } from "../../exporter/importJsonWriter";
import { writeCapturedItems } from "../../exporter/writeCapturedItems";
import { ensureParentDirs } from "../../utils/filesystem";
import { withExportSession } from "../exportSession";
import {
    openFunctionEditor,
    openFunctionSettings,
    readAutomaticExecutionTicks,
} from "./shared";
import { functionIconFromSnapshot } from "./icon";
import { getSessionFunctionIcon, resetFunctionNameSession } from "./listFunctions";

export type ExportFunctionOptions = {
    name: string;
    importJsonPath: string;
    htslPath: string;
    htslReference: string;
    rootDir: string;
};

export type SharedExportState = {
    itemCaptures: ItemCaptureRegistry;
    inventorySnapshot: InventorySnapshot;
};

async function readFunction(
    ctx: TaskContext,
    name: string,
    itemCaptures?: ItemCaptureRegistry
): Promise<{ actions: Action[]; repeatTicks?: number }> {
    if ((await openFunctionEditor(ctx, name)) === "missing") {
        throw new Error(`No function named "${name}" exists in this housing.`);
    }

    const observed = await readActionList(
        ctx,
        { kind: "full" },
        itemCaptures !== undefined ? { itemCaptures } : undefined
    );
    const actions = observedSlotsToActions(observed);

    await clickGoBack(ctx);
    await openFunctionSettings(ctx, name);

    const repeatTicks = readAutomaticExecutionTicks(ctx);
    await clickGoBack(ctx);
    const validRepeatTicks = repeatTicks !== undefined && repeatTicks >= 4 && repeatTicks <= 18000
        ? repeatTicks
        : undefined;
    return validRepeatTicks !== undefined ? { actions, repeatTicks: validRepeatTicks } : { actions };
}

/**
 * Read a function from the live house into a full `ImportableFunction` AST
 * (actions + repeat + icon), writing nothing. Shared by the exporter and the
 * Houses-tab deep read (which caches the result instead of writing import.json).
 */
export async function readFunctionImportable(
    ctx: TaskContext,
    name: string,
    itemCaptures?: ItemCaptureRegistry
): Promise<ImportableFunction> {
    // The icon lives on the /functions list slot, not the editor — read it first.
    const icon = functionIconFromSnapshot(await getSessionFunctionIcon(ctx, name));
    const { actions, repeatTicks } = await readFunction(ctx, name, itemCaptures);
    return {
        type: "FUNCTION",
        name,
        actions,
        ...(repeatTicks !== undefined ? { repeatTicks } : {}),
        ...(icon !== undefined ? { icon } : {}),
    };
}

export async function exportFunction(
    ctx: TaskContext,
    options: ExportFunctionOptions
): Promise<void> {
    return withExportSession(() => exportFunctionInner(ctx, options));
}

async function exportFunctionInner(
    ctx: TaskContext,
    options: ExportFunctionOptions
): Promise<void> {
    // Drop any function-list cache from a prior import so the icon read reflects
    // the live house, not a stale snapshot.
    resetFunctionNameSession();
    const inventorySnapshot: InventorySnapshot = snapshotInventory();
    const itemCaptures = new ItemCaptureRegistry();

    let exportError: unknown = null;
    try {
        await exportFunctionWithSharedState(ctx, options, {
            itemCaptures,
            inventorySnapshot,
        });
    } catch (error) {
        exportError = error;
    }

    try {
        const itemCount = writeCapturedItems(
            ctx,
            itemCaptures,
            options.rootDir,
            options.importJsonPath
        );
        if (exportError === null) {
            ctx.displayMessage(
                `&7[export] &fItems captured: ${itemCount}`
            );
            ctx.displayMessage(`&7  -> ${options.importJsonPath}`);
        }
    } finally {
        try {
            await restoreInventoryToSnapshot(ctx, inventorySnapshot);
        } catch (error) {
            ctx.displayMessage(
                `&7[export] &eInventory restore failed (export results still written): ${error}`
            );
        }
    }

    if (exportError !== null) {
        throw exportError;
    }
}

export async function exportFunctionWithSharedState(
    ctx: TaskContext,
    options: ExportFunctionOptions,
    shared: SharedExportState
): Promise<void> {
    const { name, importJsonPath, htslPath, htslReference } = options;

    const importable = await readFunctionImportable(ctx, name, shared.itemCaptures);
    const actions = importable.actions ?? [];
    const repeatTicks = importable.repeatTicks;
    const icon = importable.icon;

    const { source, diagnostics } = htsw.htsl.printActionsWithDiagnostics(actions);
    for (const diag of diagnostics) {
        ctx.displayMessage(`&7[export] &e${diag.message}`);
    }

    ensureParentDirs(htslPath);
    FileLib.write(htslPath, source, true);

    upsertImportableEntry(importJsonPath, "functions", {
        name,
        actions: htslReference,
        ...(repeatTicks !== undefined ? { repeatTicks } : {}),
        ...(icon !== undefined ? { icon } : {}),
    });

    await tryWriteImportableCache(ctx, importable, "exporter");

    ctx.displayMessage(
        `&aExported function '${name}' (${actions.length} action${actions.length === 1 ? "" : "s"})`
    );
    ctx.displayMessage(`&7  -> ${htslPath}`);
}
