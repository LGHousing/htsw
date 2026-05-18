import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../../importer/itemCapture";
import TaskContext from "../../tasks/context";
import { isTaskCancelled } from "../../tasks/manager";
import { withExportSession } from "../exportSession";
import { openHtswGui } from "../../gui/overlay";
import { setActiveRightTab } from "../../gui/state/selection";
import { exportFunctionWithSharedState } from "./export";
import { writeCapturedItems } from "../../exporter/writeCapturedItems";
import { htslFilenameForFunctionExport } from "../../exporter/paths";
import { listAllFunctionNames } from "./listFunctions";

export type ExportAllFunctionsOptions = {
    importJsonPath: string;
    rootDir: string;
    /**
     * If provided, export exactly these functions in this order. Skips
     * the Housing `/functions` list walk entirely — useful for the
     * `/export import.json` flow where the caller already knows which
     * subset to re-export. A name that doesn't exist in the housing
     * falls through the existing per-function `catch` and the batch
     * continues with the next one.
     */
    names?: readonly string[];
};

/**
 * Batch-export every function in the current housing to one workspace.
 *
 * - Snapshot inventory once at the start; restore once at the end.
 * - One shared `ItemCaptureRegistry` so an item used by N functions
 *   produces ONE `.snbt` file and N action references.
 * - One pass over the housing's function list; per-function failures
 *   log and continue rather than aborting the batch.
 * - Captured items are written once after every function completes,
 *   so the on-disk view matches the dedup state.
 */
export async function exportAllFunctions(
    ctx: TaskContext,
    options: ExportAllFunctionsOptions
): Promise<void> {
    return withExportSession(() => exportAllFunctionsInner(ctx, options));
}

async function exportAllFunctionsInner(
    ctx: TaskContext,
    options: ExportAllFunctionsOptions
): Promise<void> {
    const { importJsonPath, rootDir } = options;

    // The single-function path opens the GUI and switches to the import
    // tab inside `exportFunctionWithSharedState`. We do the same setup
    // once up front so the preview is visible from the first function
    // onward; the per-function call will re-issue these but they're
    // idempotent.
    openHtswGui();
    setActiveRightTab("import");

    const inventorySnapshot: InventorySnapshot = snapshotInventory();
    const itemCaptures = new ItemCaptureRegistry();

    const names =
        options.names !== undefined
            ? options.names
            : await listAllFunctionNames(ctx);
    if (names.length === 0) {
        ctx.displayMessage("&7No functions to export.");
        try {
            await restoreInventoryToSnapshot(ctx, inventorySnapshot);
        } catch (error) {
            ctx.displayMessage(
                `&7[export] &eInventory restore failed: ${error}`
            );
        }
        return;
    }

    ctx.displayMessage(
        `&aExporting ${names.length} function${names.length === 1 ? "" : "s"}...`
    );

    let succeeded = 0;
    let failed = 0;
    try {
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            const filename = htslFilenameForFunctionExport(importJsonPath, name);
            const htslPath = `${rootDir}/${filename}`;
            const htslReference = filename;

            ctx.displayMessage(
                `&7[${i + 1}/${names.length}] &fExporting '${name}'`
            );

            try {
                await exportFunctionWithSharedState(
                    ctx,
                    {
                        name,
                        importJsonPath,
                        htslPath,
                        htslReference,
                        rootDir,
                    },
                    { itemCaptures, inventorySnapshot }
                );
                succeeded++;
            } catch (error) {
                // `/export stop` (or the GUI cancel button) throws a
                // TaskCancelledError through ctx.waitFor / withTimeout.
                // Don't swallow it — rethrow so the batch loop unwinds
                // instead of ploughing through the remaining 200+
                // functions logging "failed" for each one. Genuine
                // per-function failures (timeout, malformed action, etc.)
                // are still logged and skipped, which is the resilient
                // batch behavior we want.
                if (isTaskCancelled(error)) {
                    throw error;
                }
                failed++;
                ctx.displayMessage(
                    `&c[export-all] failed on '${name}': ${error}`
                );
            }
        }
    } finally {
        // Flush whatever was captured to disk — even on cancel — so the
        // user doesn't lose the in-memory registry's contents. Pure file
        // IO; doesn't consult the cancel flag and is safe to run after
        // a TaskCancelledError has been thrown.
        writeCapturedItems(ctx, itemCaptures, rootDir, importJsonPath);
    }

    const itemCount = itemCaptures.size();

    try {
        await restoreInventoryToSnapshot(ctx, inventorySnapshot);
    } catch (error) {
        ctx.displayMessage(
            `&7[export] &eInventory restore failed (export results still written): ${error}`
        );
    }

    ctx.displayMessage(
        `&aExported ${succeeded} of ${names.length} function${names.length === 1 ? "" : "s"} (${itemCount} item${itemCount === 1 ? "" : "s"} captured)${failed > 0 ? ` &c[${failed} failed]` : ""}`
    );
    ctx.displayMessage(`&7  -> ${importJsonPath}`);
}
