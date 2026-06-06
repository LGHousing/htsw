import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../../housingSync/itemCapture";
import TaskContext from "../../tasks/context";
import { isTaskCancelled } from "../../tasks/manager";
import { withExportSession } from "../exportSession";
import { exportFunctionWithSharedState } from "./export";
import { writeCapturedItems } from "../../exporter/writeCapturedItems";
import { htslFilenameForFunctionExport } from "../../exporter/paths";
import type { ExportProgressSink } from "../../housingSync/progress/types";
import { listAllFunctionNames } from "./listFunctions";

export type ExportAllFunctionsOptions = {
    importJsonPath: string;
    rootDir: string;
    names?: readonly string[];
    progress?: ExportProgressSink;
};

export type ExportAllFunctionsResult = { succeeded: number; failed: number };

export async function exportAllFunctions(
    ctx: TaskContext,
    options: ExportAllFunctionsOptions
): Promise<ExportAllFunctionsResult> {
    return withExportSession(() => exportAllFunctionsInner(ctx, options));
}

async function exportAllFunctionsInner(
    ctx: TaskContext,
    options: ExportAllFunctionsOptions
): Promise<ExportAllFunctionsResult> {
    const { importJsonPath, rootDir } = options;

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
        return { succeeded: 0, failed: 0 };
    }

    ctx.displayMessage(
        `&aExporting ${names.length} function${names.length === 1 ? "" : "s"}...`
    );
    options.progress?.start(names);

    let succeeded = 0;
    let failed = 0;
    try {
        for (let i = 0; i < names.length; i++) {
            const name = names[i];
            const filename = htslFilenameForFunctionExport(importJsonPath, name);
            const htslPath = `${rootDir}/${filename}`;
            const htslReference = filename;

            options.progress?.item(i, name);
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
        `&aExported ${succeeded} of ${names.length} function${names.length === 1 ? "" : "s"} (${itemCount} item${itemCount === 1 ? "" : "s"} captured)${failed > 0 ? ` &c[${failed} failed]` : ""}`
    );
    ctx.displayMessage(`&7  -> ${importJsonPath}`);

    return { succeeded, failed };
}
