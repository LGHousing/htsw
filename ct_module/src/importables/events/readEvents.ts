import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../../housingSync/itemCapture";
import TaskContext from "../../tasks/context";
import { runReadLoop, type ReadResult, type ReadOptions } from "../read";
import { exportEventWithSharedState } from "./export";
import { writeCapturedItems } from "../items/writeCapturedItems";
import {
    eventExportReferencesExist,
    htslTargetForEventExport,
} from "../../project/paths";
import { listAllEventNames } from "./listEvents";
import { filterAlreadyExported } from "../exportSkip";

export async function readEvents(
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

    let names0: readonly string[];
    if (options.names !== undefined) {
        names0 = options.names;
    } else {
        names0 = await listAllEventNames(ctx);
        options.onNamesListed?.(names0);
    }
    const names = filterAlreadyExported(
        ctx,
        "event",
        names0,
        readOnly ? false : options.skipExisting,
        (name) => eventExportReferencesExist(importJsonPath, name)
    );
    if (names.length === 0) {
        ctx.displayMessage(`&7No events to ${readOnly ? "read" : "export"}.`);
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
        `&a${verb} ${names.length} event${names.length === 1 ? "" : "s"}...`
    );
    let succeeded = 0;
    let failed = 0;
    try {
        const result = await runReadLoop(ctx, {
            names,
            verb,
            progress: options.progress,
            processOne: async (ctx, name, onReadProgress) => {
                const target = htslTargetForEventExport(importJsonPath, name);
                await exportEventWithSharedState(
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
            `&aRead ${succeeded} of ${names.length} event${names.length === 1 ? "" : "s"}${failed > 0 ? ` &c[${failed} failed]` : ""}`
        );
        return { total: names.length, succeeded, failed };
    }

    const itemCount = itemCaptures.size();

    ctx.displayMessage(
        `&aExported ${succeeded} of ${names.length} event${names.length === 1 ? "" : "s"} (${itemCount} item${itemCount === 1 ? "" : "s"} captured)${failed > 0 ? ` &c[${failed} failed]` : ""}`
    );
    ctx.displayMessage(`&7  -> ${importJsonPath}`);

    return { total: names.length, succeeded, failed };
}
