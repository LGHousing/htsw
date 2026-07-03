import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../../housingSync/itemCapture";
import TaskContext from "../../tasks/context";
import { runReadLoop, type ReadResult, type ReadOptions } from "../read";
import { exportFunctionWithSharedState } from "./export";
import { writeCapturedItems } from "../items/writeCapturedItems";
import {
    functionExportReferencesExist,
    htslTargetForFunctionExport,
} from "../../project/paths";
import { listAllFunctionNames, resetFunctionNameSession } from "./listFunctions";
import { filterAlreadyExported } from "../exportSkip";

export async function readFunctions(
    ctx: TaskContext,
    options: ReadOptions
): Promise<ReadResult> {
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
    let succeeded = 0;
    let failed = 0;
    try {
        const result = await runReadLoop(ctx, {
            names,
            verb,
            progress: options.progress,
            processOne: async (ctx, name, onReadProgress) => {
                const target = htslTargetForFunctionExport(importJsonPath, name);
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
                        onReadProgress,
                    },
                    { itemCaptures, inventorySnapshot }
                );
            },
        });
        succeeded = result.succeeded;
        failed = result.failed;
    } finally {
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
