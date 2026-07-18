import type TaskContext from "../tasks/context";
import { exportAllNpcs } from "./npcs/exportAll";
import { createExportProgressSink } from "../gui/export/progressSink";
import { readProjectItemsForExport, type ExportProjectContext } from "./exportContext";
import {
    HOUSE_EXPORT_TYPES,
    houseExportTypeOf,
    type HouseExportTypeName,
} from "./houseExportTypes";
import {
    functionExportReferencesExist,
    readFunctionNamesFromImportJson,
    readNpcEntriesFromImportJson,
} from "../project/paths";
import type { ReadResult } from "./read";

export type ExportBatchType = HouseExportTypeName | "NPC";
export type NamedExportType = Exclude<HouseExportTypeName, "EVENT">;

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
    destination: ExportProjectContext,
    request: ExportBatchRequest
): Promise<ReadResult> {
    const { importJsonPath, rootDir, projectItems } = destination;
    if (request.type === "NPC") {
        return exportAllNpcs(ctx, {
            importJsonPath,
            rootDir,
            projectItems,
            entries: request.entries,
            skipExisting: request.skipExisting,
            progress: createExportProgressSink("NPC", importJsonPath),
        });
    }
    return houseExportTypeOf(request.type).read(ctx, {
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
    destination: ExportProjectContext,
    request: ExportBatchRequest
): Promise<ReadResult> {
    const result = await exportBatch(ctx, destination, request);
    destination.projectItems = readProjectItemsForExport(destination.importJsonPath);
    return result;
}

export async function exportExisting(
    ctx: TaskContext,
    destination: ExportProjectContext
): Promise<ReadResult> {
    const { importJsonPath } = destination;
    const result: ReadResult = { total: 0, succeeded: 0, failed: 0 };

    for (let i = 0; i < HOUSE_EXPORT_TYPES.length; i++) {
        const spec = HOUSE_EXPORT_TYPES[i];
        const names = spec.declaredNames(importJsonPath);
        if (names.length === 0) continue;
        addReadResult(result, await exportBatchAndRefreshProjectItems(ctx, destination, {
            type: spec.type,
            names,
        }));
    }

    const npcEntries = readNpcEntriesFromImportJson(importJsonPath);
    if (npcEntries.length > 0) {
        addReadResult(result, await exportBatchAndRefreshProjectItems(ctx, destination, {
            type: "NPC",
            entries: npcEntries,
        }));
    }

    if (result.total === 0) {
        const sections = HOUSE_EXPORT_TYPES.map((spec) => `${spec.token}s[]`).join(", ");
        ctx.displayMessage(
            `&cNo ${sections}, or npcs[] entries found in ${importJsonPath}`
        );
    }
    return result;
}

function addReadResult(target: ReadResult, result: ReadResult): void {
    target.total += result.total;
    target.succeeded += result.succeeded;
    target.failed += result.failed;
}
