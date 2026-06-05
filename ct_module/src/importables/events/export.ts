import type { Action, Event, ImportableEvent } from "htsw/types";
import * as htsw from "htsw";

import { readActionList } from "../../housingSync/actions/readList";
import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../../housingSync/itemCapture";
import { tryWriteImportableCache } from "../../importCache";
import TaskContext from "../../tasks/context";
import { observedSlotsToActions } from "../../exporter/sanitize";
import { upsertImportableEntry } from "../../exporter/importJsonWriter";
import { writeCapturedItems } from "../../exporter/writeCapturedItems";
import { ensureParentDirs } from "../../utils/filesystem";
import { withExportSession } from "../exportSession";
import { openEventEditor } from "./shared";

export type ExportEventOptions = {
    name: string;
    importJsonPath: string;
    htslPath: string;
    htslReference: string;
    rootDir: string;
};

export type SharedExportState = {
    itemCaptures: ItemCaptureRegistry;
    inventorySnapshot: InventorySnapshot;
};

async function readEvent(
    ctx: TaskContext,
    eventName: string,
    itemCaptures?: ItemCaptureRegistry
): Promise<Action[]> {
    await openEventEditor(ctx, eventName);
    const observed = await readActionList(
        ctx,
        { kind: "full" },
        itemCaptures !== undefined ? { itemCaptures } : undefined
    );
    return observedSlotsToActions(observed);
}

export async function exportEvent(
    ctx: TaskContext,
    options: ExportEventOptions
): Promise<void> {
    return withExportSession(() => exportEventInner(ctx, options));
}

async function exportEventInner(
    ctx: TaskContext,
    options: ExportEventOptions
): Promise<void> {
    const inventorySnapshot: InventorySnapshot = snapshotInventory();
    const itemCaptures = new ItemCaptureRegistry();

    let exportError: unknown = null;
    try {
        await exportEventWithSharedState(ctx, options, {
            itemCaptures,
            inventorySnapshot,
        });
    } catch (error) {
        exportError = error;
    }

    try {
        const itemCount = writeCapturedItems(
            ctx,
            itemCaptures,
            options.rootDir,
            options.importJsonPath
        );
        if (exportError === null) {
            ctx.displayMessage(`&7[export] &fItems captured: ${itemCount}`);
            ctx.displayMessage(`&7  -> ${options.importJsonPath}`);
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

    if (exportError !== null) {
        throw exportError;
    }
}

export async function exportEventWithSharedState(
    ctx: TaskContext,
    options: ExportEventOptions,
    shared: SharedExportState
): Promise<void> {
    const { name, importJsonPath, htslPath, htslReference } = options;

    const actions = await readEvent(ctx, name, shared.itemCaptures);

    const importable: ImportableEvent = {
        type: "EVENT",
        event: name as Event,
        actions,
    };

    const { source, diagnostics } = htsw.htsl.printActionsWithDiagnostics(actions);
    for (const diag of diagnostics) {
        ctx.displayMessage(`&7[export] &e${diag.message}`);
    }

    ensureParentDirs(htslPath);
    FileLib.write(htslPath, source, true);

    upsertImportableEntry(importJsonPath, "events", {
        event: name,
        actions: htslReference,
    });

    await tryWriteImportableCache(ctx, importable, "exporter");

    ctx.displayMessage(
        `&aExported event '${name}' (${actions.length} action${actions.length === 1 ? "" : "s"})`
    );
    ctx.displayMessage(`&7  -> ${htslPath}`);
}
