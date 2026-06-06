import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../../housingSync/itemCapture";
import TaskContext from "../../tasks/context";
import { isTaskCancelled } from "../../tasks/manager";
import { withExportSession } from "../exportSession";
import { exportEventWithSharedState } from "./export";
import { writeCapturedItems } from "../../exporter/writeCapturedItems";
import { htslFilenameForEventExport } from "../../exporter/paths";
import type { ExportProgressSink } from "../../housingSync/progress/types";
import { listAllEventNames } from "./listEvents";

export type ExportAllEventsOptions = {
    importJsonPath: string;
    rootDir: string;
    names?: readonly string[];
    progress?: ExportProgressSink;
};

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
    options.progress?.start(names);

    let succeeded = 0;
    let failed = 0;
    try {
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            const filename = htslFilenameForEventExport(importJsonPath, name);
            const htslPath = `${rootDir}/${filename}`;
            const htslReference = filename;

            options.progress?.item(i, name);
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
        options.progress?.done();
        try {
            writeCapturedItems(ctx, itemCaptures, rootDir, importJsonPath);
        } finally {
            try {
                await restoreInventoryToSnapshot(ctx, inventorySnapshot);
            } catch (error) {
                ctx.displayMessage(
                    `&7[export] &eInventory restore failed (export results still written): ${error}`
                );
            }
        }
    }

    const itemCount = itemCaptures.size();

    ctx.displayMessage(
        `&aExported ${succeeded} of ${names.length} event${names.length === 1 ? "" : "s"} (${itemCount} item${itemCount === 1 ? "" : "s"} captured)${failed > 0 ? ` &c[${failed} failed]` : ""}`
    );
    ctx.displayMessage(`&7  -> ${importJsonPath}`);
}
