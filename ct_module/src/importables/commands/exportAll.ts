import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../../housingSync/itemCapture";
import TaskContext from "../../tasks/context";
import type { ImportableItem } from "htsw/types";
import { isTaskCancelled } from "../../tasks/manager";
import { ExportResult, withExportSession } from "../exportSession";
import { exportCommandWithSharedState } from "./export";
import { writeCapturedItems } from "../../exporter/writeCapturedItems";
import {
    commandExportReferencesExist,
    htslTargetForCommandExport,
} from "../../project/paths";
import type { ExportProgressSink } from "../../housingSync/progress/types";
import {
    commandNameForHousing,
    listAllCommandNames,
    resetCommandNameSession,
} from "./listCommands";
import { filterAlreadyExported } from "../exportSkip";

export type ExportAllCommandsOptions = {
    importJsonPath: string;
    rootDir: string;
    names?: readonly string[];
    progress?: ExportProgressSink;
    projectItems?: readonly ImportableItem[];
    skipExisting?: boolean;
};

export async function exportAllCommands(
    ctx: TaskContext,
    options: ExportAllCommandsOptions
): Promise<ExportResult> {
    return withExportSession(() => exportAllCommandsInner(ctx, options));
}

async function exportAllCommandsInner(
    ctx: TaskContext,
    options: ExportAllCommandsOptions
): Promise<ExportResult> {
    const { importJsonPath, rootDir } = options;

    resetCommandNameSession();

    const inventorySnapshot: InventorySnapshot = snapshotInventory();
    const itemCaptures = new ItemCaptureRegistry();
    const projectItems = options.projectItems ?? [];
    for (let i = 0; i < projectItems.length; i++) {
        itemCaptures.seed(projectItems[i].name, projectItems[i].nbt);
    }

    const names =
        options.names !== undefined
            ? options.names.map(commandNameForHousing)
            : await listAllCommandNames(ctx);
    const exportNames = filterAlreadyExported(
        ctx,
        "command",
        names,
        options.skipExisting,
        (name) => commandExportReferencesExist(importJsonPath, name)
    );
    if (exportNames.length === 0) {
        ctx.displayMessage("&7No commands to export.");
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
        `&aExporting ${exportNames.length} command${exportNames.length === 1 ? "" : "s"}...`
    );
    options.progress?.start(exportNames);

    let succeeded = 0;
    let failed = 0;
    try {
        for (let i = 0; i < exportNames.length; i++) {
            ctx.checkCancelled();
            const name = exportNames[i];
            const target = htslTargetForCommandExport(importJsonPath, name);

            options.progress?.item(i, name);
            ctx.displayMessage(
                `&7[${i + 1}/${exportNames.length}] &fExporting '/${name}'`
            );

            const sink = options.progress;
            try {
                await exportCommandWithSharedState(
                    ctx,
                    {
                        name,
                        importJsonPath,
                        declaringJsonPath: target.importJsonPath,
                        htslPath: target.htslPath,
                        htslReference: target.htslReference,
                        rootDir,
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
                    `&c[export-all] failed on '/${name}': ${error}`
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

    const itemCounts = itemCaptures.counts();
    ctx.displayMessage(
        `&aExported ${succeeded} of ${exportNames.length} command${exportNames.length === 1 ? "" : "s"} (items: ${itemCounts.matched} matched, ${itemCounts.fresh} new)${failed > 0 ? ` &c[${failed} failed]` : ""}`
    );
    ctx.displayMessage(`&7  -> ${importJsonPath}`);

    return { total: exportNames.length, succeeded, failed };
}
