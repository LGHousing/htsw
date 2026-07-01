import type TaskContext from "../tasks/context";
import { exportAllFunctions } from "../importables/functions/exportAll";
import { exportAllEvents } from "../importables/events/exportAll";
import { exportAllMenus } from "../importables/menus/exportAll";
import { exportAllRegions } from "../importables/regions/exportAll";
import { exportAllCommands } from "../importables/commands/exportAll";
import { exportAllNpcs } from "../importables/npcs/exportAll";
import { createExportProgressSink } from "../gui/right-panel/import-tab/exportProgress";
import { readProjectItemsForExport } from "../importables/exportContext";
import {
    readEventNamesFromImportJson,
    readFunctionNamesFromImportJson,
    readMenuNamesFromImportJson,
    readCommandNamesFromImportJson,
    readNpcEntriesFromImportJson,
    functionExportReferencesExist,
    readRegionNamesFromImportJson,
} from "../project/paths";
import type { ExportDestination } from "./exportDestination";

export type ExportBatchRequest =
    | { type: "FUNCTION"; names?: readonly string[]; skipExisting?: boolean }
    | { type: "EVENT"; names?: readonly string[]; skipExisting?: boolean }
    | { type: "MENU"; names?: readonly string[]; skipExisting?: boolean }
    | { type: "REGION"; names?: readonly string[]; skipExisting?: boolean }
    | { type: "COMMAND"; names?: readonly string[]; skipExisting?: boolean }
    | {
          type: "NPC";
          entries?: ReturnType<typeof readNpcEntriesFromImportJson>;
          skipExisting?: boolean;
      };

export type ExportBatchType = ExportBatchRequest["type"];
export type NamedExportType = Exclude<ExportBatchType, "EVENT" | "NPC">;

export function notYetExportedFunctionNames(
    importJsonPath: string,
    liveNames: readonly string[]
): { names: string[]; skipped: number; missingTargets: number } {
    const declared = new Set(readFunctionNamesFromImportJson(importJsonPath));
    const names: string[] = [];
    let skipped = 0;
    let missingTargets = 0;

    for (let i = 0; i < liveNames.length; i++) {
        const name = liveNames[i];
        if (!declared.has(name)) {
            names.push(name);
            continue;
        }

        if (functionExportReferencesExist(importJsonPath, name)) {
            skipped++;
            continue;
        }

        missingTargets++;
        names.push(name);
    }

    return { names, skipped, missingTargets };
}

export async function exportBatch(
    ctx: TaskContext,
    destination: ExportDestination,
    request: ExportBatchRequest
): Promise<void> {
    const { importJsonPath, rootDir, projectItems } = destination;
    switch (request.type) {
        case "FUNCTION":
            await exportAllFunctions(ctx, {
                importJsonPath,
                rootDir,
                projectItems,
                names: request.names,
                skipExisting: request.skipExisting,
                progress: createExportProgressSink("FUNCTION", importJsonPath),
            });
            return;
        case "EVENT":
            await exportAllEvents(ctx, {
                importJsonPath,
                rootDir,
                projectItems,
                names: request.names,
                skipExisting: request.skipExisting,
                progress: createExportProgressSink("EVENT", importJsonPath),
            });
            return;
        case "MENU":
            await exportAllMenus(ctx, {
                importJsonPath,
                rootDir,
                projectItems,
                names: request.names,
                skipExisting: request.skipExisting,
                progress: createExportProgressSink("MENU", importJsonPath),
            });
            return;
        case "REGION":
            await exportAllRegions(ctx, {
                importJsonPath,
                rootDir,
                projectItems,
                names: request.names,
                skipExisting: request.skipExisting,
                progress: createExportProgressSink("REGION", importJsonPath),
            });
            return;
        case "COMMAND":
            await exportAllCommands(ctx, {
                importJsonPath,
                rootDir,
                projectItems,
                names: request.names,
                skipExisting: request.skipExisting,
                progress: createExportProgressSink("COMMAND", importJsonPath),
            });
            return;
        case "NPC":
            await exportAllNpcs(ctx, {
                importJsonPath,
                rootDir,
                projectItems,
                entries: request.entries,
                skipExisting: request.skipExisting,
                progress: createExportProgressSink("NPC", importJsonPath),
            });
            return;
        default: {
            const _check: never = request;
            void _check;
        }
    }
}

async function exportBatchAndRefreshProjectItems(
    ctx: TaskContext,
    destination: ExportDestination,
    request: ExportBatchRequest
): Promise<void> {
    await exportBatch(ctx, destination, request);
    destination.projectItems = readProjectItemsForExport(destination.importJsonPath);
}

export async function exportExisting(
    ctx: TaskContext,
    destination: ExportDestination
): Promise<void> {
    const { importJsonPath } = destination;
    const functionNames = readFunctionNamesFromImportJson(importJsonPath);
    const eventNames = readEventNamesFromImportJson(importJsonPath);
    const menuNames = readMenuNamesFromImportJson(importJsonPath);
    const regionNames = readRegionNamesFromImportJson(importJsonPath);
    const commandNames = readCommandNamesFromImportJson(importJsonPath);
    const npcEntries = readNpcEntriesFromImportJson(importJsonPath);
    if (
        functionNames.length === 0 &&
        eventNames.length === 0 &&
        menuNames.length === 0 &&
        regionNames.length === 0 &&
        commandNames.length === 0 &&
        npcEntries.length === 0
    ) {
        ctx.displayMessage(
            `&cNo functions[], events[], menus[], regions[], commands[], or npcs[] entries found in ${importJsonPath}`
        );
        return;
    }

    if (functionNames.length > 0) {
        await exportBatchAndRefreshProjectItems(ctx, destination, {
            type: "FUNCTION",
            names: functionNames,
        });
    }
    if (eventNames.length > 0) {
        await exportBatchAndRefreshProjectItems(ctx, destination, {
            type: "EVENT",
            names: eventNames,
        });
    }
    if (menuNames.length > 0) {
        await exportBatchAndRefreshProjectItems(ctx, destination, {
            type: "MENU",
            names: menuNames,
        });
    }
    if (regionNames.length > 0) {
        await exportBatchAndRefreshProjectItems(ctx, destination, {
            type: "REGION",
            names: regionNames,
        });
    }
    if (commandNames.length > 0) {
        await exportBatchAndRefreshProjectItems(ctx, destination, {
            type: "COMMAND",
            names: commandNames,
        });
    }
    if (npcEntries.length > 0) {
        await exportBatchAndRefreshProjectItems(ctx, destination, {
            type: "NPC",
            entries: npcEntries,
        });
    }
}
