import type { Action, ImportableFunction } from "htsw/types";
import * as htsw from "htsw";

import { readActionList } from "../../importer/actions";
import { clickGoBack } from "../../importer/helpers";
import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../../importer/itemCapture";
import { setActiveDiffSink } from "../../importer/diffSink";
import { getCurrentHousingUuid, writeKnowledge } from "../../knowledge";
import TaskContext from "../../tasks/context";
import { observedSlotsToActions } from "../../exporter/sanitize";
import { upsertImportableEntry } from "../../exporter/importJsonWriter";
import { writeCapturedItems } from "../../exporter/writeCapturedItems";
import { ensureParentDirs } from "../../utils/filesystem";
import { withExportSession } from "../exportSession";
import { makeDiffSink } from "../../gui/right-panel/import-actions";
import { openHtswGui } from "../../gui/overlay";
import { setActiveRightTab } from "../../gui/state/selection";
import { setCurrentImportingPath } from "../../gui/state";
import {
    openFunctionEditor,
    openFunctionSettings,
    readAutomaticExecutionTicks,
} from "./shared";

export type ExportFunctionOptions = {
    /** The function name as known to Hypixel Housing. */
    name: string;
    /** Path to the `import.json` to upsert into (will be created if absent). */
    importJsonPath: string;
    /** Path to the `.htsl` file to write (typically alongside the import.json). */
    htslPath: string;
    /**
     * Path string to record in `import.json`'s `actions` field. This should be
     * the relative path from `import.json` to `htslPath` so the importer can
     * follow the reference.
     */
    htslReference: string;
    /**
     * Absolute path to the export's root directory. Captured `.snbt` files
     * land at `<rootDir>/items/<slug>.snbt` and are referenced from
     * `import.json` via the relative path `"items/<slug>.snbt"`.
     */
    rootDir: string;
};

/**
 * Resolve a function name to its observed action list and repeatTicks.
 *
 * Reuses the importer's `readActionList` (so nested CONDITIONAL/RANDOM
 * bodies hydrate correctly via the existing hydration plan) and a
 * targeted right-click on the function list slot for `repeatTicks`,
 * matching the importer's read pattern.
 *
 * When `itemCaptures` is provided, the read pass also performs
 * click-to-copy item NBT capture for every item-bearing action or
 * condition encountered (including nested ones inside CONDITIONAL /
 * RANDOM bodies).
 */
async function readFunction(
    ctx: TaskContext,
    name: string,
    itemCaptures: ItemCaptureRegistry
): Promise<{ actions: Action[]; repeatTicks?: number }> {
    if ((await openFunctionEditor(ctx, name)) === "missing") {
        throw new Error(`No function named "${name}" exists in this housing.`);
    }

    // Full hydration: the exporter wants every nested action body and
    // every item-bearing field captured with real NBT, not just the
    // ones a sync diff would care about. `topLevel: true` marks this as
    // the outermost call in the export session so the live-preview
    // animation knows to fire its hooks (cursor moves, observed-snapshot
    // emits). Recursive `readActionList` calls inside CONDITIONAL/RANDOM
    // bodies omit the flag and self-identify as nested.
    const observed = await readActionList(ctx, {
        kind: "full",
        itemCaptures,
        topLevel: true,
    });
    const actions = observedSlotsToActions(observed);

    // The function-list right-click menu owns repeatTicks. Mirrors the
    // importer's write path for function import.
    await clickGoBack(ctx);
    await openFunctionSettings(ctx, name);

    const repeatTicks = readAutomaticExecutionTicks(ctx);
    await clickGoBack(ctx);
    return repeatTicks !== undefined ? { actions, repeatTicks } : { actions };
}

/**
 * Shared state for a batch export (e.g. `/export all function`). The
 * orchestrator snapshots inventory once at the start of the batch and
 * builds one registry so items appearing in multiple functions are
 * captured once, written once, and referenced N times.
 */
export type SharedExportState = {
    itemCaptures: ItemCaptureRegistry;
    /**
     * Captured at batch start. NOT restored by
     * `exportFunctionWithSharedState` — the orchestrator restores once
     * after the batch finishes.
     */
    inventorySnapshot: InventorySnapshot;
};

/**
 * High-level export-a-function flow: snapshot inventory, open in GUI,
 * read state (capturing item NBTs along the way), write `.htsl`, write
 * captured `.snbt` files, upsert `import.json`, refresh knowledge cache,
 * restore inventory, report to chat.
 *
 * Inventory restoration is best-effort: failures don't abort the export
 * since the user's `.htsl` and `.snbt` files are already on disk by then.
 */
export async function exportFunction(
    ctx: TaskContext,
    options: ExportFunctionOptions
): Promise<void> {
    return withExportSession(() => exportFunctionInner(ctx, options));
}

async function exportFunctionInner(
    ctx: TaskContext,
    options: ExportFunctionOptions
): Promise<void> {
    // Snapshot inventory BEFORE any captures so we can restore it after.
    // Captured items get added to the player's inventory by Hypixel during
    // the click-to-copy flow; without this snapshot/restore they'd
    // accumulate across exports.
    const inventorySnapshot: InventorySnapshot = snapshotInventory();
    const itemCaptures = new ItemCaptureRegistry();

    let exportError: unknown = null;
    try {
        await exportFunctionWithSharedState(ctx, options, {
            itemCaptures,
            inventorySnapshot,
        });
    } catch (error) {
        exportError = error;
    }

    // Single-function: write the captured items here. The batch
    // orchestrator calls `writeCapturedItems` itself once after every
    // function completes against the shared registry, which is why
    // `exportFunctionWithSharedState` no longer does it.
    const itemCount = writeCapturedItems(
        ctx,
        itemCaptures,
        options.rootDir,
        options.importJsonPath
    );
    if (exportError === null) {
        ctx.displayMessage(
            `&7[export] &fItems captured: ${itemCount}`
        );
        ctx.displayMessage(`&7  -> ${options.importJsonPath}`);
    }

    // Restore inventory unconditionally — even on partial-export failure
    // the player shouldn't be left with leftover captured items.
    try {
        await restoreInventoryToSnapshot(ctx, inventorySnapshot);
    } catch (error) {
        ctx.displayMessage(
            `&7[export] &eInventory restore failed (export results still written): ${error}`
        );
    }

    if (exportError !== null) {
        throw exportError;
    }
}

/**
 * Per-function export body that reuses inventory snapshot + item
 * registry supplied by the caller. Manages its own diff sink,
 * `setCurrentImportingPath`, and trace tagging so the live-preview
 * panel resets cleanly for each function. Does NOT snapshot or restore
 * inventory and does NOT write captured items — both belong to the
 * caller, which spans the batch.
 */
export async function exportFunctionWithSharedState(
    ctx: TaskContext,
    options: ExportFunctionOptions,
    shared: SharedExportState
): Promise<void> {
    const { name, importJsonPath, htslPath, htslReference } = options;
    const { itemCaptures } = shared;

    // Wire up the same live-preview diff sink the importer uses, keyed by
    // the planned .htsl output path. The sink primes the preview from the
    // HTSW knowledge cache (if there's a prior import of a same-named
    // function, gray placeholder lines show immediately) and then morphs
    // to the freshly-read housing state as the read progresses — same UX
    // the user sees during /import.
    //
    // The shell importable is the minimum the sink factory needs to seed
    // the trace + cache prime — fields that aren't known yet (actions,
    // repeatTicks) get filled in later but the sink never re-reads them.
    const importableShell: ImportableFunction = {
        type: "FUNCTION",
        name,
        actions: [],
    };
    const sink = makeDiffSink(htslPath, importableShell);
    setActiveDiffSink(sink);

    // Make sure the live-preview panel is actually showing the file we're
    // about to populate. Without these three calls the sink fires events
    // into a model the panel doesn't read from (because the GUI is hidden
    // OR on the View tab OR pointed at a different file). Matches what
    // `startImport` does on the import side, just inlined since exports
    // don't go through the queue UI.
    openHtswGui();
    setActiveRightTab("import");
    setCurrentImportingPath(htslPath);

    let exportError: unknown = null;
    let actions: Action[] = [];
    let repeatTicks: number | undefined;
    try {
        const result = await readFunction(ctx, name, itemCaptures);
        actions = result.actions;
        repeatTicks = result.repeatTicks;
    } catch (error) {
        exportError = error;
    }

    if (exportError === null) {
        const importable: ImportableFunction = {
            type: "FUNCTION",
            name,
            actions,
            ...(repeatTicks !== undefined ? { repeatTicks } : {}),
        };

        // Dump the read action tree to a debug file BEFORE we attempt
        // to print it. If `printActionsWithDiagnostics` then crashes
        // (e.g., an undefined enum field on some action triggers a
        // defensive fallback), the operator can open this file to see
        // exactly which action carries the malformed field.
        const dumpPath = `./htsw/export-debug-${Date.now()}.json`;
        try {
            ensureParentDirs(dumpPath);
            FileLib.write(
                dumpPath,
                JSON.stringify({ name, repeatTicks, actions }, null, 2),
                true
            );
        } catch (_error) {
            // Debug dump is best-effort — don't abort the export.
        }

        // Print HTSL. Surface any printer warnings (e.g. item-NBT
        // placeholders that we couldn't capture) before we touch disk.
        const { source, diagnostics } = htsw.htsl.printActionsWithDiagnostics(actions);
        for (const diag of diagnostics) {
            ctx.displayMessage(`&7[export] &e${diag.message}`);
        }
        ctx.displayMessage(`&7[export] &fAction tree dumped to ${dumpPath}`);

        // FileLib.write doesn't create parent dirs. When the import.json
        // reference is something like `actions/main.htsl`, the export
        // silently failed before — mkdir first so subdir-organized exports
        // work.
        ensureParentDirs(htslPath);

        FileLib.write(htslPath, source, true);

        upsertImportableEntry(importJsonPath, "functions", {
            name,
            actions: htslReference,
            ...(repeatTicks !== undefined ? { repeatTicks } : {}),
        });

        // Knowledge cache reflects what was just on the housing: exporter writer.
        try {
            const housingUuid = await getCurrentHousingUuid(ctx);
            writeKnowledge(ctx, housingUuid, importable, "exporter");
        } catch (error) {
            ctx.displayMessage(`&7[export] &eCache write skipped: ${error}`);
        }

        ctx.displayMessage(
            `&aExported function '${name}' (${actions.length} action${actions.length === 1 ? "" : "s"})`
        );
        ctx.displayMessage(`&7  -> ${htslPath}`);
    }

    // Drop the diff sink so the next /import or /export starts clean.
    // The `end()` callback parks the cursor and refreshes knowledge rows
    // before unhooking, matching the import-side teardown.
    try {
        sink.end();
    } catch (_error) {
        // Sink teardown is best-effort.
    }
    setActiveDiffSink(null);
    // Match the import-side teardown: clear the "currently importing"
    // file path so the live-preview panel falls back to its empty state
    // for the next operation. The preview model itself stays populated
    // and would be re-shown if the user explicitly navigates to that
    // file in the View tab.
    setCurrentImportingPath(null);

    if (exportError !== null) {
        throw exportError;
    }
}
