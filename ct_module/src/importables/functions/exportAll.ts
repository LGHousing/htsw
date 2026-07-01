import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../../housingSync/itemCapture";
import TaskContext from "../../tasks/context";
import type { ImportableItem } from "htsw/types";
import { isTaskCancelled } from "../../tasks/manager";
import type { ExportResult } from "../exports";
import { exportFunctionWithSharedState } from "./export";
import { writeCapturedItems } from "../../exporter/writeCapturedItems";
import {
    functionExportReferencesExist,
    htslTargetForFunctionExport,
} from "../../project/paths";
import type { ExportProgressSink } from "../../housingSync/progress/types";
import { listAllFunctionNames, resetFunctionNameSession } from "./listFunctions";
import { filterAlreadyExported } from "../exportSkip";

export type ExportAllFunctionsOptions = {
    importJsonPath: string;
    rootDir: string;
    names?: readonly string[];
    progress?: ExportProgressSink;
    // Knowledge-only pass: same editor walk, but nothing is written to
    // .htsl/import.json/item files (see ExportFunctionOptions.readOnly).
    readOnly?: { housingUuid: string };
    // Items the destination project already declares; seeds the capture
    // registry so identical captures reuse project names instead of minting
    // duplicates. Callers with a warm parse should always pass this.
    projectItems?: readonly ImportableItem[];
    // Fires when the driver listed the house's functions itself (no `names`
    // supplied), so the caller can record the scan.
    onNamesListed?: (names: readonly string[]) => void;
    skipExisting?: boolean;
};

export async function exportAllFunctions(
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
    const projectItems = options.projectItems ?? [];
    for (let i = 0; i < projectItems.length; i++) {
        itemCaptures.seed(projectItems[i].name, projectItems[i].nbt);
    }

    let names: readonly string[];
    if (options.names !== undefined) {
        names = options.names;
    } else {
        names = await listAllFunctionNames(ctx);
        options.onNamesListed?.(names);
    }
    names = filterAlreadyExported(
        ctx,
        "function",
        names,
        readOnly ? false : options.skipExisting,
        (name) => functionExportReferencesExist(importJsonPath, name)
    );
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
            ctx.checkCancelled();
            const name = names[i];
            const target = htslTargetForFunctionExport(importJsonPath, name);

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
                        declaringJsonPath: target.importJsonPath,
                        htslPath: target.htslPath,
                        htslReference: target.htslReference,
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

    const hints = itemCaptures.takeHints();
    for (let i = 0; i < hints.length; i++) {
        ctx.displayMessage(`&e[export] ${hints[i]}`);
    }
    const itemCounts = itemCaptures.counts();

    if (readOnly) {
        ctx.displayMessage(
            `&aRead ${succeeded} of ${names.length} function${names.length === 1 ? "" : "s"}${failed > 0 ? ` &c[${failed} failed]` : ""}`
        );
    } else {
        ctx.displayMessage(
            `&aExported ${succeeded} of ${names.length} function${names.length === 1 ? "" : "s"} (items: ${itemCounts.matched} matched, ${itemCounts.fresh} new)${failed > 0 ? ` &c[${failed} failed]` : ""}`
        );
        ctx.displayMessage(`&7  -> ${importJsonPath}`);
    }

    return { total: names.length, succeeded, failed };
}
