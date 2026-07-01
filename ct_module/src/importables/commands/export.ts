import type { ImportableCommand, ImportableItem } from "htsw/types";
import * as htsw from "htsw";

import { readActionList } from "../../housingSync/actions/readList";
import type { ProgressHandler } from "../../housingSync/progress/types";
import {
    ItemCaptureRegistry,
    restoreInventoryToSnapshot,
    snapshotInventory,
    type InventorySnapshot,
} from "../../housingSync/itemCapture";
import { tryWriteImportableCache } from "../../importCache";
import TaskContext from "../../tasks/context";
import { observedSlotsToActions } from "../../housingSync/observedActions";
import { upsertImportableEntry } from "../../project/importJsonMutations";
import { writeCapturedItems } from "../items/writeCapturedItems";
import { ensureParentDirs } from "../../utils/filesystem";
import {
    openCommandSettings,
    openExistingCommandActionsEditor,
    readOpenCommandSettings,
} from "./shared";
import { commandNameForHousing, resetCommandNameSession } from "./listCommands";

export type ExportCommandOptions = {
    name: string;
    importJsonPath: string;
    declaringJsonPath?: string;
    htslPath: string;
    htslReference: string;
    rootDir: string;
    onReadProgress?: ProgressHandler;
    projectItems?: readonly ImportableItem[];
};

export type SharedExportState = {
    itemCaptures: ItemCaptureRegistry;
    inventorySnapshot: InventorySnapshot;
};

async function readCommand(
    ctx: TaskContext,
    name: string,
    itemCaptures?: ItemCaptureRegistry,
    onReadProgress?: ProgressHandler
): Promise<ImportableCommand> {
    await openExistingCommandActionsEditor(ctx, name);
    const observed = await readActionList(ctx, { kind: "deep" }, {
        ...(itemCaptures !== undefined ? { itemCaptures } : {}),
        ...(onReadProgress !== undefined
            ? {
                  progress: onReadProgress,
                  phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 0 },
              }
            : {}),
    });
    const actions = observedSlotsToActions(observed);

    await openCommandSettings(ctx, name);
    const settings = readOpenCommandSettings(ctx);
    if (settings.listed === null) {
        throw new Error(
            `Could not read listed state for command "/${name}".`
        );
    }

    return {
        type: "COMMAND",
        name,
        actions,
        mode: settings.mode,
        requiredPriority: settings.requiredPriority,
        listed: settings.listed,
    };
}

export async function exportCommand(
    ctx: TaskContext,
    options: ExportCommandOptions
): Promise<void> {
    return exportCommandInner(ctx, options);
}

async function exportCommandInner(
    ctx: TaskContext,
    options: ExportCommandOptions
): Promise<void> {
    resetCommandNameSession();
    const inventorySnapshot: InventorySnapshot = snapshotInventory();
    const itemCaptures = new ItemCaptureRegistry();
    const projectItems = options.projectItems ?? [];
    for (let i = 0; i < projectItems.length; i++) {
        itemCaptures.seed(projectItems[i].name, projectItems[i].nbt);
    }

    let exportError: unknown = null;
    try {
        await exportCommandWithSharedState(ctx, options, {
            itemCaptures,
            inventorySnapshot,
        });
    } catch (error) {
        exportError = error;
    }

    try {
        writeCapturedItems(ctx, itemCaptures, options.rootDir, options.importJsonPath);
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

export async function exportCommandWithSharedState(
    ctx: TaskContext,
    options: ExportCommandOptions,
    shared: SharedExportState
): Promise<void> {
    const name = commandNameForHousing(options.name);
    const { importJsonPath, htslPath, htslReference } = options;

    const importable = await readCommand(
        ctx,
        name,
        shared.itemCaptures,
        options.onReadProgress
    );

    const actions = importable.actions ?? [];
    const { source, diagnostics } = htsw.htsl.printActionsWithDiagnostics(actions);
    for (const diag of diagnostics) {
        ctx.displayMessage(`&7[export] &e${diag.message}`);
    }

    ensureParentDirs(htslPath);
    FileLib.write(htslPath, source, true);

    upsertImportableEntry(options.declaringJsonPath ?? importJsonPath, "commands", {
        name,
        actions: htslReference,
        mode: importable.mode,
        requiredPriority: importable.requiredPriority,
        listed: importable.listed,
    });

    await tryWriteImportableCache(ctx, importable, "exporter");

    ctx.displayMessage(
        `&aExported command '/${name}' (${actions.length} action${actions.length === 1 ? "" : "s"})`
    );
    ctx.displayMessage(`&7  -> ${htslPath}`);
}
