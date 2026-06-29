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
import { writeCapturedItems } from "../../exporter/writeCapturedItems";
import {
    htslTargetsForRegionExport,
    regionExportReferencesExist,
} from "../../project/paths";
import type { ExportProgressSink } from "../../housingSync/progress/types";
import { listAllRegions, type RegionListEntry } from "./listRegions";
import { exportRegionWithSharedState } from "./export";
import { filterAlreadyExported } from "../exportSkip";

export type ExportAllRegionsOptions = {
    importJsonPath: string;
    rootDir: string;
    names?: readonly string[];
    progress?: ExportProgressSink;
    projectItems?: readonly ImportableItem[];
    skipExisting?: boolean;
};

export async function exportAllRegions(
    ctx: TaskContext,
    options: ExportAllRegionsOptions
): Promise<ExportResult> {
    return withExportSession(() => exportAllRegionsInner(ctx, options));
}

function findRegion(
    regions: readonly RegionListEntry[],
    name: string
): RegionListEntry | null {
    for (let i = 0; i < regions.length; i++) {
        if (regions[i].name === name) return regions[i];
    }
    return null;
}

async function exportAllRegionsInner(
    ctx: TaskContext,
    options: ExportAllRegionsOptions
): Promise<ExportResult> {
    const { importJsonPath, rootDir } = options;

    const inventorySnapshot: InventorySnapshot = snapshotInventory();
    const itemCaptures = new ItemCaptureRegistry();
    const projectItems = options.projectItems ?? [];
    for (let i = 0; i < projectItems.length; i++) {
        itemCaptures.seed(projectItems[i].name, projectItems[i].nbt);
    }

    const regions = await listAllRegions(ctx);
    const names =
        options.names !== undefined
            ? options.names
            : regions.map((region) => region.name);
    const exportNames = filterAlreadyExported(
        ctx,
        "region",
        names,
        options.skipExisting,
        (name) => regionExportReferencesExist(importJsonPath, name)
    );
    if (exportNames.length === 0) {
        ctx.displayMessage("&7No regions to export.");
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
        `&aExporting ${exportNames.length} region${exportNames.length === 1 ? "" : "s"}...`
    );
    options.progress?.start(exportNames);

    let succeeded = 0;
    let failed = 0;
    try {
        for (let i = 0; i < exportNames.length; i++) {
            ctx.checkCancelled();
            const name = exportNames[i];
            const target = htslTargetsForRegionExport(importJsonPath, name);

            options.progress?.item(i, name);
            ctx.displayMessage(
                `&7[${i + 1}/${exportNames.length}] &fExporting '${name}'`
            );

            const sink = options.progress;
            try {
                const entry = findRegion(regions, name);
                if (entry === null) {
                    throw new Error(`No region named "${name}" exists in this housing.`);
                }
                await exportRegionWithSharedState(
                    ctx,
                    {
                        entry,
                        importJsonPath,
                        declaringJsonPath: target.importJsonPath,
                        onEnterTarget: target.onEnter,
                        onExitTarget: target.onExit,
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

    const itemCounts = itemCaptures.counts();

    ctx.displayMessage(
        `&aExported ${succeeded} of ${exportNames.length} region${exportNames.length === 1 ? "" : "s"} (items: ${itemCounts.matched} matched, ${itemCounts.fresh} new)${failed > 0 ? ` &c[${failed} failed]` : ""}`
    );
    ctx.displayMessage(`&7  -> ${importJsonPath}`);

    return { total: exportNames.length, succeeded, failed };
}
