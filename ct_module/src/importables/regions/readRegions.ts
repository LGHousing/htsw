import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../../housingSync/itemCapture";
import TaskContext from "../../tasks/context";
import { runReadLoop, type ReadResult, type ReadOptions } from "../read";
import { writeCapturedItems } from "../items/writeCapturedItems";
import {
    htslTargetsForRegionExport,
    regionExportReferencesExist,
} from "../../project/paths";
import { listAllRegions, type RegionListEntry } from "./listRegions";
import { exportRegionWithSharedState } from "./export";
import { filterAlreadyExported } from "../exportSkip";

function findRegion(
    regions: readonly RegionListEntry[],
    name: string
): RegionListEntry | null {
    for (let i = 0; i < regions.length; i++) {
        if (regions[i].name === name) return regions[i];
    }
    return null;
}

export async function readRegions(
    ctx: TaskContext,
    options: ReadOptions
): Promise<ReadResult> {
    const { importJsonPath, rootDir } = options;
    const readOnly = options.readOnly !== undefined;
    const verb = readOnly ? "Reading" : "Exporting";

    const inventorySnapshot: InventorySnapshot = snapshotInventory();
    const itemCaptures = new ItemCaptureRegistry();
    const projectItems = options.projectItems ?? [];
    for (let i = 0; i < projectItems.length; i++) {
        itemCaptures.seed(projectItems[i].name, projectItems[i].nbt);
    }

    const regions = await listAllRegions(ctx);
    let names: readonly string[];
    if (options.names !== undefined) {
        names = options.names;
    } else {
        names = regions.map((region) => region.name);
        options.onNamesListed?.(names);
    }
    const exportNames = filterAlreadyExported(
        ctx,
        "region",
        names,
        readOnly ? false : options.skipExisting,
        (name) => regionExportReferencesExist(importJsonPath, name)
    );
    if (exportNames.length === 0) {
        ctx.displayMessage(`&7No regions to ${readOnly ? "read" : "export"}.`);
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
        `&a${verb} ${exportNames.length} region${exportNames.length === 1 ? "" : "s"}...`
    );
    let succeeded = 0;
    let failed = 0;
    try {
        const result = await runReadLoop(ctx, {
            names: exportNames,
            verb,
            progress: options.progress,
            processOne: async (ctx, name, onReadProgress) => {
                const entry = findRegion(regions, name);
                if (entry === null) {
                    throw new Error(`No region named "${name}" exists in this housing.`);
                }
                const target = htslTargetsForRegionExport(importJsonPath, name);
                await exportRegionWithSharedState(
                    ctx,
                    {
                        entry,
                        importJsonPath,
                        declaringJsonPath: target.importJsonPath,
                        onEnterTarget: target.onEnter,
                        onExitTarget: target.onExit,
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
            `&aRead ${succeeded} of ${exportNames.length} region${exportNames.length === 1 ? "" : "s"}${failed > 0 ? ` &c[${failed} failed]` : ""}`
        );
        return { total: exportNames.length, succeeded, failed };
    }

    const itemCounts = itemCaptures.counts();

    ctx.displayMessage(
        `&aExported ${succeeded} of ${exportNames.length} region${exportNames.length === 1 ? "" : "s"} (items: ${itemCounts.matched} matched, ${itemCounts.fresh} new)${failed > 0 ? ` &c[${failed} failed]` : ""}`
    );
    ctx.displayMessage(`&7  -> ${importJsonPath}`);

    return { total: exportNames.length, succeeded, failed };
}
