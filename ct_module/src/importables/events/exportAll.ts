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
import { exportEventWithSharedState } from "./export";
import { writeCapturedItems } from "../../exporter/writeCapturedItems";
import {
    eventExportReferencesExist,
    htslTargetForEventExport,
} from "../../project/paths";
import type { ExportProgressSink } from "../../housingSync/progress/types";
import { listAllEventNames } from "./listEvents";
import { filterAlreadyExported } from "../exportSkip";

export type ExportAllEventsOptions = {
    importJsonPath: string;
    rootDir: string;
    names?: readonly string[];
    progress?: ExportProgressSink;
    // Items the destination project already declares; seeds the capture
    // registry so identical captures reuse project names (see functions).
    projectItems?: readonly ImportableItem[];
    skipExisting?: boolean;
};

export async function exportAllEvents(
    ctx: TaskContext,
    options: ExportAllEventsOptions
): Promise<ExportResult> {
    const { importJsonPath, rootDir } = options;

    const inventorySnapshot: InventorySnapshot = snapshotInventory();
    const itemCaptures = new ItemCaptureRegistry();
    const projectItems = options.projectItems ?? [];
    for (let i = 0; i < projectItems.length; i++) {
        itemCaptures.seed(projectItems[i].name, projectItems[i].nbt);
    }

    const names0 =
        options.names !== undefined
            ? options.names
            : await listAllEventNames(ctx);
    const names = filterAlreadyExported(
        ctx,
        "event",
        names0,
        options.skipExisting,
        (name) => eventExportReferencesExist(importJsonPath, name)
    );
    if (names.length === 0) {
        ctx.displayMessage("&7No events to export.");
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
        `&aExporting ${names.length} event${names.length === 1 ? "" : "s"}...`
    );
    options.progress?.start(names);

    let succeeded = 0;
    let failed = 0;
    try {
        for (let i = 0; i < names.length; i++) {
            ctx.checkCancelled();
            const name = names[i];
            const target = htslTargetForEventExport(importJsonPath, name);

            options.progress?.item(i, name);
            ctx.displayMessage(
                `&7[${i + 1}/${names.length}] &fExporting '${name}'`
            );

            const sink = options.progress;
            try {
                await exportEventWithSharedState(
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

    return { total: names.length, succeeded, failed };
}
