import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../../housingSync/itemCapture";
import TaskContext from "../../tasks/context";
import { runReadLoop, type ReadResult, type ReadOptions } from "../read";
import { exportCommandWithSharedState } from "./export";
import { writeCapturedItems } from "../items/writeCapturedItems";
import {
    commandExportReferencesExist,
    htslTargetForCommandExport,
} from "../../project/paths";
import {
    listAllCommandNames,
    resetCommandNameSession,
} from "./listCommands";
import { filterAlreadyExported } from "../exportSkip";

export async function readCommands(
    ctx: TaskContext,
    options: ReadOptions
): Promise<ReadResult> {
    const { importJsonPath, rootDir } = options;
    const readOnly = options.readOnly !== undefined;
    const verb = readOnly ? "Reading" : "Exporting";

    resetCommandNameSession();

    const inventorySnapshot: InventorySnapshot = snapshotInventory();
    const itemCaptures = new ItemCaptureRegistry();
    const projectItems = options.projectItems ?? [];
    for (let i = 0; i < projectItems.length; i++) {
        itemCaptures.seed(projectItems[i].name, projectItems[i].nbt);
    }

    let names: readonly string[];
    if (options.names !== undefined) {
        names = options.names.slice();
    } else {
        names = await listAllCommandNames(ctx);
        options.onNamesListed?.(names);
    }
    const exportNames = filterAlreadyExported(
        ctx,
        "command",
        names,
        readOnly ? false : options.skipExisting,
        (name) => commandExportReferencesExist(importJsonPath, name)
    );
    if (exportNames.length === 0) {
        ctx.displayMessage(`&7No commands to ${readOnly ? "read" : "export"}.`);
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
        `&a${verb} ${exportNames.length} command${exportNames.length === 1 ? "" : "s"}...`
    );
    let succeeded = 0;
    let failed = 0;
    try {
        const result = await runReadLoop(ctx, {
            names: exportNames,
            verb,
            displayName: (name) => `/${name}`,
            progress: options.progress,
            processOne: async (ctx, name, onReadProgress) => {
                const target = htslTargetForCommandExport(importJsonPath, name);
                await exportCommandWithSharedState(
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

    if (readOnly) {
        ctx.displayMessage(
            `&aRead ${succeeded} of ${exportNames.length} command${exportNames.length === 1 ? "" : "s"}${failed > 0 ? ` &c[${failed} failed]` : ""}`
        );
        return { total: exportNames.length, succeeded, failed };
    }

    const itemCounts = itemCaptures.counts();
    ctx.displayMessage(
        `&aExported ${succeeded} of ${exportNames.length} command${exportNames.length === 1 ? "" : "s"} (items: ${itemCounts.matched} matched, ${itemCounts.fresh} new)${failed > 0 ? ` &c[${failed} failed]` : ""}`
    );
    ctx.displayMessage(`&7  -> ${importJsonPath}`);

    return { total: exportNames.length, succeeded, failed };
}
