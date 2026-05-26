import type { Action, Event, ImportableEvent } from "htsw/types";
import * as htsw from "htsw";

import { readActionList } from "../../importer/actions";
import {
    ItemCaptureRegistry,
    type InventorySnapshot,
} from "../../importer/itemCapture";
import { setActiveDiffSink } from "../../importer/diffSink";
import { getCurrentHousingUuid, writeKnowledge } from "../../knowledge";
import TaskContext from "../../tasks/context";
import { observedSlotsToActions } from "../../exporter/sanitize";
import { upsertImportableEntry } from "../../exporter/importJsonWriter";
import { ensureParentDirs } from "../../utils/filesystem";
import { makeDiffSink } from "../../gui/right-panel/import-actions";
import { openHtswGui } from "../../gui/overlay";
import { setActiveRightTab } from "../../gui/state/selection";
import { setCurrentImportingPath } from "../../gui/state";
import { openEventEditor } from "./shared";

export type ExportEventOptions = {
    /** The event identifier as known to Hypixel Housing (e.g. "Player Join"). */
    name: string;
    /** Path to the `import.json` to upsert into (will be created if absent). */
    importJsonPath: string;
    /** Path to the `.htsl` file to write (typically alongside the import.json). */
    htslPath: string;
    /**
     * Path string to record in `import.json`'s `actions` field. Relative
     * to `import.json` so the importer can follow the reference.
     */
    htslReference: string;
    /**
     * Absolute path to the export's root directory. Captured `.snbt` files
     * land at `<rootDir>/items/<slug>.snbt` and are referenced from
     * `import.json` via `"items/<slug>.snbt"`.
     */
    rootDir: string;
};

/**
 * Open the event's action editor and read its full action list. Matches
 * the function exporter's `readFunction` shape, minus the right-click
 * settings step — events have no `repeatTicks` or `icon` to read.
 */
async function readEvent(
    ctx: TaskContext,
    eventName: string,
    itemCaptures: ItemCaptureRegistry
): Promise<Action[]> {
    await openEventEditor(ctx, eventName);

    const observed = await readActionList(ctx, {
        kind: "full",
        itemCaptures,
        topLevel: true,
    });
    return observedSlotsToActions(observed);
}

/**
 * Shared state for a batch event export (e.g. `/export all event`).
 * Identical shape to functions' SharedExportState so the orchestrator
 * pattern stays symmetric across importable types.
 */
export type SharedExportState = {
    itemCaptures: ItemCaptureRegistry;
    /**
     * Captured at batch start. NOT restored by
     * `exportEventWithSharedState` — the orchestrator restores once
     * after the batch finishes.
     */
    inventorySnapshot: InventorySnapshot;
};

/**
 * Per-event export body that reuses inventory snapshot + item registry
 * supplied by the caller. Manages its own diff sink so the live-preview
 * panel resets cleanly per event. Does NOT snapshot or restore
 * inventory and does NOT write captured items — both belong to the
 * caller (single-event wrapper or `exportAllEvents` orchestrator).
 */
export async function exportEventWithSharedState(
    ctx: TaskContext,
    options: ExportEventOptions,
    shared: SharedExportState
): Promise<void> {
    const { name, importJsonPath, htslPath, htslReference } = options;
    const { itemCaptures } = shared;

    // Wire the same live-preview diff sink the function exporter uses,
    // keyed by the planned .htsl output path. The sink primes the
    // preview from the HTSW knowledge cache (if there's a prior import
    // of the same event, gray placeholder lines show immediately) and
    // then morphs to the freshly-read housing state.
    const importableShell: ImportableEvent = {
        type: "EVENT",
        event: name as Event,
        actions: [],
    };
    const sink = makeDiffSink(htslPath, importableShell);
    setActiveDiffSink(sink);

    openHtswGui();
    setActiveRightTab("import");
    setCurrentImportingPath(htslPath);

    let exportError: unknown = null;
    let actions: Action[] = [];
    try {
        actions = await readEvent(ctx, name, itemCaptures);
    } catch (error) {
        exportError = error;
    }

    if (exportError === null) {
        const importable: ImportableEvent = {
            type: "EVENT",
            event: name as Event,
            actions,
        };

        const dumpPath = `./htsw/export-debug-${Date.now()}.json`;
        try {
            ensureParentDirs(dumpPath);
            FileLib.write(
                dumpPath,
                JSON.stringify({ event: name, actions }, null, 2),
                true
            );
        } catch (_error) {
            // Debug dump is best-effort — don't abort the export.
        }

        const { source, diagnostics } = htsw.htsl.printActionsWithDiagnostics(actions);
        for (const diag of diagnostics) {
            ctx.displayMessage(`&7[export] &e${diag.message}`);
        }
        ctx.displayMessage(`&7[export] &fAction tree dumped to ${dumpPath}`);

        ensureParentDirs(htslPath);
        FileLib.write(htslPath, source, true);

        upsertImportableEntry(importJsonPath, "events", {
            event: name,
            actions: htslReference,
        });

        try {
            const housingUuid = await getCurrentHousingUuid(ctx);
            writeKnowledge(ctx, housingUuid, importable, "exporter");
        } catch (error) {
            ctx.displayMessage(`&7[export] &eCache write skipped: ${error}`);
        }

        ctx.displayMessage(
            `&aExported event '${name}' (${actions.length} action${actions.length === 1 ? "" : "s"})`
        );
        ctx.displayMessage(`&7  -> ${htslPath}`);
    }

    try {
        sink.end();
    } catch (_error) {
        // Sink teardown is best-effort.
    }
    setActiveDiffSink(null);
    setCurrentImportingPath(null);

    if (exportError !== null) {
        throw exportError;
    }
}
