import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../../housingSync/itemCapture";
import TaskContext from "../../tasks/context";
import { isTaskCancelled } from "../../tasks/manager";
import { ExportResult, withExportSession } from "../exportSession";
import { exportFunctionWithSharedState } from "./export";
import { writeCapturedItems } from "../../exporter/writeCapturedItems";
import { htslFilenameForFunctionExport } from "../../exporter/paths";
import type { ExportProgressSink } from "../../housingSync/progress/types";
import { listAllFunctionNames, resetFunctionNameSession } from "./listFunctions";

export type ExportAllFunctionsOptions = {
    importJsonPath: string;
    rootDir: string;
    names?: readonly string[];
    progress?: ExportProgressSink;
    // Knowledge-only pass: same editor walk, but nothing is written to
    // .htsl/import.json/item files (see ExportFunctionOptions.readOnly).
    readOnly?: { housingUuid: string };
    // Fires when the driver listed the house's functions itself (no `names`
    // supplied), so the caller can record the scan.
    onNamesListed?: (names: readonly string[]) => void;
};

export async function exportAllFunctions(
    ctx: TaskContext,
    options: ExportAllFunctionsOptions
): Promise<ExportResult> {
    return withExportSession(() => exportAllFunctionsInner(ctx, options));
}

async function exportAllFunctionsInner(
    ctx: TaskContext,
    options: ExportAllFunctionsOptions
): Promise<ExportResult> {
    const { importJsonPath, rootDir } = options;
    const readOnly = options.readOnly !== undefined;
    const verb = readOnly ? "Reading" : "Exporting";

    // Drop any function-list cache from a prior import so per-function icon
    // reads reflect the live house, not a stale snapshot.
    resetFunctionNameSession();

    const inventorySnapshot: InventorySnapshot = snapshotInventory();
    const itemCaptures = new ItemCaptureRegistry();

    let names: readonly string[];
    if (options.names !== undefined) {
        names = options.names;
    } else {
        names = await listAllFunctionNames(ctx);
        options.onNamesListed?.(names);
    }
    if (names.length === 0) {
        ctx.displayMessage(`&7No functions to ${readOnly ? "read" : "export"}.`);
        try {
            await restoreInventoryToSnapshot(ctx, inventorySnapshot);
        } catch (error) {
            ctx.displayMessage(
                `&7[export] &eInventory restore failed: ${error}`
            );
        }
        return { total: 0, succeeded: 0, failed: 0 };
    }

    ctx.displayMessage(
        `&a${verb} ${names.length} function${names.length === 1 ? "" : "s"}...`
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
                `&7[${i + 1}/${names.length}] &f${verb} '${name}'`
            );

            const sink = options.progress;
            try {
                await exportFunctionWithSharedState(
                    ctx,
                    {
                        name,
                        importJsonPath,
                        htslPath,
                        htslReference,
                        rootDir,
                        readOnly: options.readOnly,
                        onReadProgress:
                            sink?.itemProgress === undefined
                                ? undefined
                                : (payload) => sink.itemProgress!(i, payload),
                    },
                    { itemCaptures, inventorySnapshot }
                );
                succeeded++;
            } catch (error) {
                if (isTaskCancelled(error)) {
                    throw error;
                }
                failed++;
                sink?.itemFailed?.(i, String(error));
                ctx.displayMessage(
                    `&c[export-all] failed on '${name}': ${error}`
                );
            }
        }
    } finally {
        options.progress?.done();
        try {
            if (!readOnly) {
                writeCapturedItems(ctx, itemCaptures, rootDir, importJsonPath);
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
    }

    const itemCount = itemCaptures.size();

    if (readOnly) {
        ctx.displayMessage(
            `&aRead ${succeeded} of ${names.length} function${names.length === 1 ? "" : "s"}${failed > 0 ? ` &c[${failed} failed]` : ""}`
        );
    } else {
        ctx.displayMessage(
            `&aExported ${succeeded} of ${names.length} function${names.length === 1 ? "" : "s"} (${itemCount} item${itemCount === 1 ? "" : "s"} captured)${failed > 0 ? ` &c[${failed} failed]` : ""}`
        );
        ctx.displayMessage(`&7  -> ${importJsonPath}`);
    }

    return { total: names.length, succeeded, failed };
}
