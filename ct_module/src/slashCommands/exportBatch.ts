import type TaskContext from "../tasks/context";
import { exportAllNpcs } from "../importables/npcs/exportAll";
import { createExportProgressSink } from "../gui/export/progressSink";
import { readProjectItemsForExport } from "../importables/exportContext";
import {
    HOUSE_EXPORT_TYPES,
    houseExportTypeOf,
    type HouseExportTypeName,
} from "../importables/houseExportTypes";
import {
    functionExportReferencesExist,
    readFunctionNamesFromImportJson,
    readNpcEntriesFromImportJson,
} from "../project/paths";
import type { ExportDestination } from "./exportDestination";

export type ExportBatchType = HouseExportTypeName | "NPC";
export type NamedExportType = Exclude<HouseExportTypeName, "EVENT">;

// Name-based types share one shape; NPCs carry position-keyed entries instead.
export type ExportBatchRequest =
    | { type: HouseExportTypeName; names?: readonly string[]; skipExisting?: boolean }
    | {
          type: "NPC";
          entries?: ReturnType<typeof readNpcEntriesFromImportJson>;
          skipExisting?: boolean;
      };

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
    if (request.type === "NPC") {
        await exportAllNpcs(ctx, {
            importJsonPath,
            rootDir,
            projectItems,
            entries: request.entries,
            skipExisting: request.skipExisting,
            progress: createExportProgressSink("NPC", importJsonPath),
        });
        return;
    }
    await houseExportTypeOf(request.type).read(ctx, {
        importJsonPath,
        rootDir,
        projectItems,
        names: request.names,
        skipExisting: request.skipExisting,
        progress: createExportProgressSink(request.type, importJsonPath),
    });
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
    let exportedAny = false;

    for (let i = 0; i < HOUSE_EXPORT_TYPES.length; i++) {
        const spec = HOUSE_EXPORT_TYPES[i];
        const names = spec.declaredNames(importJsonPath);
        if (names.length === 0) continue;
        exportedAny = true;
        await exportBatchAndRefreshProjectItems(ctx, destination, {
            type: spec.type,
            names,
        });
    }

    const npcEntries = readNpcEntriesFromImportJson(importJsonPath);
    if (npcEntries.length > 0) {
        exportedAny = true;
        await exportBatchAndRefreshProjectItems(ctx, destination, {
            type: "NPC",
            entries: npcEntries,
        });
    }

    if (!exportedAny) {
        const sections = HOUSE_EXPORT_TYPES.map((spec) => `${spec.token}s[]`).join(", ");
        ctx.displayMessage(
            `&cNo ${sections}, or npcs[] entries found in ${importJsonPath}`
        );
    }
}
