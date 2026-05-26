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
import { exportEventWithSharedState } from "./export";
import { writeCapturedItems } from "../../exporter/writeCapturedItems";
import { htslFilenameForEventExport } from "../../exporter/paths";
import { listAllEventNames } from "./listEvents";

export type ExportAllEventsOptions = {
    importJsonPath: string;
    rootDir: string;
    /**
     * If provided, export exactly these events in this order. Skips the
     * Housing `/eventactions` walk entirely — used by `/export existing`
     * to re-export the subset declared in import.json. A name that
     * doesn't exist in the housing falls through the per-event `catch`
     * and the batch continues with the next one.
     */
    names?: readonly string[];
};

/**
 * Batch-export every event in the current housing to one workspace.
 *
 * Mirrors `exportAllFunctions`:
 * - Snapshot inventory once at the start; restore once at the end.
 * - One shared `ItemCaptureRegistry` so an item used by N events
 *   produces ONE `.snbt` file and N action references.
 * - One pass over the housing's event list; per-event failures log and
 *   continue rather than aborting the batch.
 * - Captured items are written once after every event completes, so
 *   the on-disk view matches the dedup state.
 */
export async function exportAllEvents(
    ctx: TaskContext,
    options: ExportAllEventsOptions
): Promise<void> {
    return withExportSession(() => exportAllEventsInner(ctx, options));
}

async function exportAllEventsInner(
    ctx: TaskContext,
    options: ExportAllEventsOptions
): Promise<void> {
    const { importJsonPath, rootDir } = options;

    openHtswGui();
    setActiveRightTab("import");

    const inventorySnapshot: InventorySnapshot = snapshotInventory();
    const itemCaptures = new ItemCaptureRegistry();

    const names =
        options.names !== undefined
            ? options.names
            : await listAllEventNames(ctx);
    if (names.length === 0) {
        ctx.displayMessage("&7No events to export.");
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
        `&aExporting ${names.length} event${names.length === 1 ? "" : "s"}...`
    );

    let succeeded = 0;
    let failed = 0;
    try {
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            const filename = htslFilenameForEventExport(importJsonPath, name);
            const htslPath = `${rootDir}/${filename}`;
            const htslReference = filename;

            ctx.displayMessage(
                `&7[${i + 1}/${names.length}] &fExporting '${name}'`
            );

            try {
                await exportEventWithSharedState(
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
                // instead of logging "failed" for every remaining event.
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
        // user doesn't lose the in-memory registry's contents.
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
        `&aExported ${succeeded} of ${names.length} event${names.length === 1 ? "" : "s"} (${itemCount} item${itemCount === 1 ? "" : "s"} captured)${failed > 0 ? ` &c[${failed} failed]` : ""}`
    );
    ctx.displayMessage(`&7  -> ${importJsonPath}`);
}
