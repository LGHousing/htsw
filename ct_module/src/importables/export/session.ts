import type { Importable, ImportableItem } from "htsw/types";

import type TaskContext from "../../tasks/context";
import { createExportProgressSink } from "../../gui/export/progressSink";
import { exportAllNpcs } from "../npcs/exportAll";
import {
    readProjectItemsForExport,
    type ProjectExportDestination,
} from "./projectDestination";
import {
    HOUSE_EXPORT_TYPES,
    type HouseExportTypeName,
} from "./exportTypes";
import {
    functionExportReferencesExist,
    readFunctionNamesFromImportJson,
    readNpcEntriesFromImportJson,
} from "../../project/paths";
import { HOUSE_READERS } from "./readers";
import type { ReadFn, ReadResult } from "./reader";

export type ExportBatchType = HouseExportTypeName | "NPC";
export type NamedExportType = Exclude<HouseExportTypeName, "EVENT">;

export type ExportBatchRequest =
    | { type: HouseExportTypeName; names?: readonly string[]; skipExisting?: boolean }
    | {
          type: "NPC";
          entries?: ReturnType<typeof readNpcEntriesFromImportJson>;
          skipExisting?: boolean;
      };

export type ExportSessionDestination =
    | { kind: "project"; project: ProjectExportDestination }
    | {
          kind: "cache";
          housingUuid: string;
          importJsonPath: string;
          projectItems?: readonly ImportableItem[];
      };

export type ExportSessionBatch = {
    type: Importable["type"];
    reader?: ReadFn;
    names?: readonly string[];
    npcEntries?: ReturnType<typeof readNpcEntriesFromImportJson>;
    skipExisting?: boolean;
    newExportTargetImportJson?: string;
    onNamesListed?: (names: readonly string[]) => void;
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

export async function runExportSession(
    ctx: TaskContext,
    destination: ExportSessionDestination,
    batches: readonly ExportSessionBatch[]
): Promise<ReadResult> {
    const total: ReadResult = { total: 0, succeeded: 0, failed: 0 };
    for (const batch of batches) {
        if (destination.kind === "project" && batch.type === "NPC") {
            const project = destination.project;
            const result = await exportAllNpcs(ctx, {
                ...project,
                entries: batch.npcEntries,
                skipExisting: batch.skipExisting,
                newExportTargetImportJson: batch.newExportTargetImportJson,
                progress: createExportProgressSink("NPC", project.importJsonPath),
                output: { kind: "project" },
            });
            addReadResult(total, result);
            project.projectItems = readProjectItemsForExport(project.importJsonPath);
            continue;
        }
        const reader = batch.reader ?? HOUSE_READERS[batch.type];
        if (reader === null) {
            throw new Error(`${batch.type} has no live Housing reader.`);
        }
        const target =
            destination.kind === "project"
                ? destination.project
                : {
                      importJsonPath: destination.importJsonPath,
                      rootDir: "",
                      projectItems: destination.projectItems ?? [],
                  };
        const result = await reader(ctx, {
            ...target,
            names: batch.names,
            skipExisting: batch.skipExisting,
            newExportTargetImportJson: batch.newExportTargetImportJson,
            onNamesListed: batch.onNamesListed,
            progress: createExportProgressSink(
                batch.type,
                target.importJsonPath,
                destination.kind === "cache" ? "read" : undefined
            ),
            output:
                destination.kind === "cache"
                    ? { kind: "cache", housingUuid: destination.housingUuid }
                    : { kind: "project" },
        });
        addReadResult(total, result);
        if (destination.kind === "project") {
            destination.project.projectItems = readProjectItemsForExport(
                destination.project.importJsonPath
            );
        }
    }
    return total;
}

export async function exportBatch(
    ctx: TaskContext,
    destination: ProjectExportDestination,
    request: ExportBatchRequest
): Promise<ReadResult> {
    return runExportSession(
        ctx,
        { kind: "project", project: destination },
        [
            request.type === "NPC"
                ? {
                      type: "NPC",
                      npcEntries: request.entries,
                      skipExisting: request.skipExisting,
                  }
                : {
                      type: request.type,
                      names: request.names,
                      skipExisting: request.skipExisting,
                  },
        ]
    );
}

export async function exportExisting(
    ctx: TaskContext,
    destination: ProjectExportDestination
): Promise<ReadResult> {
    const { importJsonPath } = destination;
    const batches: ExportSessionBatch[] = [];

    for (let i = 0; i < HOUSE_EXPORT_TYPES.length; i++) {
        const spec = HOUSE_EXPORT_TYPES[i];
        const names = spec.declaredNames(importJsonPath);
        if (names.length === 0) continue;
        batches.push({
            type: spec.type,
            names,
        });
    }

    const npcEntries = readNpcEntriesFromImportJson(importJsonPath);
    if (npcEntries.length > 0) {
        batches.push({
            type: "NPC",
            npcEntries,
        });
    }

    const result = await runExportSession(
        ctx,
        { kind: "project", project: destination },
        batches
    );

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
