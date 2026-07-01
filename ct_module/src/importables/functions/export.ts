import type { Action, ImportableFunction, ImportableItem } from "htsw/types";
import * as htsw from "htsw";

import { readActionList } from "../../housingSync/actions/readList";
import type { ProgressHandler } from "../../housingSync/progress/types";
import { clickGoBack } from "../../housingSync/gui/menuUtils";
import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../../housingSync/itemCapture";
import { tryWriteImportableCache } from "../../importCache";
import { writeImportableCache } from "../../importCache/cache";
import TaskContext from "../../tasks/context";
import { observedSlotsToActions } from "../../housingSync/observedActions";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { writeCapturedItems } from "../items/writeCapturedItems";
import { ensureParentDirs } from "../../utils/filesystem";
import {
    openFunctionEditor,
    openFunctionSettings,
    readAutomaticExecutionTicks,
} from "./shared";
import { functionIconFromSnapshot } from "./icon";
import { getSessionFunctionIcon, resetFunctionNameSession } from "./listFunctions";

export type ExportFunctionOptions = {
    name: string;
    /** The project's ENTRY import.json — captured items resolve against it. */
    importJsonPath: string;
    /**
     * The import.json the function's entry is upserted into: its declaring
     * file when the identity already exists somewhere in the include tree
     * (see `htslTargetForFunctionExport`). Defaults to `importJsonPath`.
     * `htslPath`/`htslReference` must be computed against the same file —
     * the reference is relative to it.
     */
    declaringJsonPath?: string;
    htslPath: string;
    htslReference: string;
    rootDir: string;
    onReadProgress?: ProgressHandler;
    // Read-only mode: same editor walk, but the result goes only into the
    // knowledge cache for this house — no .htsl/import.json writes. A deep
    // read IS an export minus the file writes; one driver serves both.
    readOnly?: { housingUuid: string };
    // Destination project's declared items, for capture matching (see
    // ItemCaptureRegistry.seed). Only read by the entry points that own a
    // registry; exportFunctionWithSharedState receives a pre-seeded one.
    projectItems?: readonly ImportableItem[];
};

export type SharedExportState = {
    itemCaptures: ItemCaptureRegistry;
    inventorySnapshot: InventorySnapshot;
};

async function readFunction(
    ctx: TaskContext,
    name: string,
    itemCaptures?: ItemCaptureRegistry,
    onReadProgress?: ProgressHandler
): Promise<{ actions: Action[]; repeatTicks?: number }> {
    if ((await openFunctionEditor(ctx, name)) === "missing") {
        throw new Error(`No function named "${name}" exists in this housing.`);
    }

    const observed = await readActionList(ctx, { kind: "deep" }, {
        ...(itemCaptures !== undefined ? { itemCaptures } : {}),
        ...(onReadProgress !== undefined
            ? {
                  progress: onReadProgress,
                  // Mutable scratch readActionList fills in as pages/child lists
                  // lists are discovered; fresh per call.
                  phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
              }
            : {}),
    });
    const actions = observedSlotsToActions(observed);

    await clickGoBack(ctx);
    await openFunctionSettings(ctx, name);

    const repeatTicks = readAutomaticExecutionTicks(ctx);
    await clickGoBack(ctx);
    const validRepeatTicks = repeatTicks !== undefined && repeatTicks >= 4 && repeatTicks <= 18000
        ? repeatTicks
        : undefined;
    return validRepeatTicks !== undefined ? { actions, repeatTicks: validRepeatTicks } : { actions };
}

/**
 * Read a function from the live house into a full `ImportableFunction` AST
 * (actions + repeat + icon), writing nothing. Shared by the exporter and the
 * Houses-tab deep read (which caches the result instead of writing import.json).
 */
async function readFunctionImportable(
    ctx: TaskContext,
    name: string,
    itemCaptures?: ItemCaptureRegistry,
    onReadProgress?: ProgressHandler
): Promise<ImportableFunction> {
    // The icon lives on the /functions list slot, not the editor — read it first.
    const icon = functionIconFromSnapshot(await getSessionFunctionIcon(ctx, name));
    const { actions, repeatTicks } = await readFunction(ctx, name, itemCaptures, onReadProgress);
    return {
        type: "FUNCTION",
        name,
        actions,
        ...(repeatTicks !== undefined ? { repeatTicks } : {}),
        ...(icon !== undefined ? { icon } : {}),
    };
}

export async function exportFunction(
    ctx: TaskContext,
    options: ExportFunctionOptions
): Promise<void> {
    // Drop any function-list cache from a prior import so the icon read reflects
    // the live house, not a stale snapshot.
    resetFunctionNameSession();
    const inventorySnapshot: InventorySnapshot = snapshotInventory();
    const itemCaptures = new ItemCaptureRegistry();
    const projectItems = options.projectItems ?? [];
    for (let i = 0; i < projectItems.length; i++) {
        itemCaptures.seed(projectItems[i].name, projectItems[i].nbt);
    }

    let exportError: unknown = null;
    try {
        await exportFunctionWithSharedState(ctx, options, {
            itemCaptures,
            inventorySnapshot,
        });
    } catch (error) {
        exportError = error;
    }

    try {
        writeCapturedItems(
            ctx,
            itemCaptures,
            options.rootDir,
            options.importJsonPath
        );
        if (exportError === null) {
            const c = itemCaptures.counts();
            ctx.displayMessage(
                `&7[export] &fItems: ${c.matched} matched, ${c.fresh} new`
            );
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

export async function exportFunctionWithSharedState(
    ctx: TaskContext,
    options: ExportFunctionOptions,
    shared: SharedExportState
): Promise<void> {
    const { name, importJsonPath, htslPath, htslReference } = options;

    const importable = await readFunctionImportable(
        ctx,
        name,
        shared.itemCaptures,
        options.onReadProgress
    );

    if (options.readOnly !== undefined) {
        // Knowledge records what's REALLY in the function — items included.
        // Captures matched against the seeded project reuse real item names;
        // unmatched ones carry minted names whose only job is to make the
        // drift diff truthfully report "differs from your project".
        writeImportableCache(ctx, options.readOnly.housingUuid, importable, "reader", true);
        return;
    }

    const actions = importable.actions ?? [];
    const repeatTicks = importable.repeatTicks;
    const icon = importable.icon;

    const { source, diagnostics } = htsw.htsl.printActionsWithDiagnostics(actions);
    for (const diag of diagnostics) {
        ctx.displayMessage(`&7[export] &e${diag.message}`);
    }

    ensureParentDirs(htslPath);
    FileLib.write(htslPath, source, true);

    upsertImportableEntry(options.declaringJsonPath ?? importJsonPath, "functions", {
        name,
        actions: htslReference,
        ...(repeatTicks !== undefined ? { repeatTicks } : {}),
        ...(icon !== undefined ? { icon } : {}),
    });

    await tryWriteImportableCache(ctx, importable, "exporter");

    ctx.displayMessage(
        `&aExported function '${name}' (${actions.length} action${actions.length === 1 ? "" : "s"})`
    );
    ctx.displayMessage(`&7  -> ${htslPath}`);
}
