import type { Importable, ImportableItem } from "htsw/types";

import type TaskContext from "../../tasks/context";
import { finishBridgeSession } from "../../bridge/status";
import { isTaskCancelled } from "../../tasks/cancellation";
import { createExportProgressSink } from "../../gui/export/progressSink";
import { exportAllNpcs } from "../npcs/exportAll";
import {
    readProjectItemsForExport,
    type ProjectExportDestination,
} from "./projectDestination";
import { readNpcEntriesFromImportJson } from "../../project/paths";
import { HOUSE_READERS } from "./readers";
import type { ReadFn, ReadResult } from "./reader";
import { writeTaskFailureLog } from "../../runtimeDebug/importFailureLog";
import type { QueueRow } from "../../gui/right-panel/import-tab/queue";
import type { HouseExportTypeName } from "./exportTypes";

export type ExportBatchType = HouseExportTypeName | "NPC";
export type NamedExportType = Exclude<HouseExportTypeName, "EVENT">;

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
    queueRows?: readonly QueueRow[];
    onQueueRowFinished?: (key: string, error?: string) => void;
};

export async function runExportSession(
    ctx: TaskContext,
    destination: ExportSessionDestination,
    batches: readonly ExportSessionBatch[]
): Promise<ReadResult> {
    const total: ReadResult = { total: 0, succeeded: 0, failed: 0 };
    let failureLogged = false;
    const phase = destination.kind === "cache" ? "deep-read" : "export";
    const sourcePath =
        destination.kind === "project"
            ? destination.project.importJsonPath
            : destination.importJsonPath;
    const housingUuid = destination.kind === "cache" ? destination.housingUuid : "";
    try {
        for (const batch of batches) {
            const onItemFailure = (
                error: unknown,
                identity: string,
                rowIndex: number
            ) => {
                if (failureLogged) return;
                failureLogged = true;
                writeTaskFailureLog(
                    {
                        phase,
                        sourcePath,
                        housingUuid,
                        importableType: batch.type,
                        identity,
                        rowIndex,
                    },
                    error
                );
            };
            if (destination.kind === "project" && batch.type === "NPC") {
                const project = destination.project;
                const result = await exportAllNpcs(ctx, {
                    ...project,
                    entries: batch.npcEntries,
                    skipExisting: batch.skipExisting,
                    newExportTargetImportJson: batch.newExportTargetImportJson,
                    progress: createExportProgressSink(
                        "NPC",
                        project.importJsonPath,
                        "export",
                        undefined,
                        {
                            queueRows: batch.queueRows,
                            onFinished: batch.onQueueRowFinished,
                        }
                    ),
                    output: { kind: "project" },
                    onItemFailure,
                });
                addReadResult(total, result);
                finishBridgeSession(result.failed > 0 ? "failed" : "completed", {
                    count: result.succeeded,
                    failed: result.failed,
                });
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
                    destination.kind === "cache" ? "read" : undefined,
                    undefined,
                    {
                        queueRows: batch.queueRows,
                        onFinished: batch.onQueueRowFinished,
                    }
                ),
                output:
                    destination.kind === "cache"
                        ? { kind: "cache", housingUuid: destination.housingUuid }
                        : { kind: "project" },
                onItemFailure,
            });
            addReadResult(total, result);
            finishBridgeSession(result.failed > 0 ? "failed" : "completed", {
                count: result.succeeded,
                failed: result.failed,
            });
            if (destination.kind === "project") {
                destination.project.projectItems = readProjectItemsForExport(
                    destination.project.importJsonPath
                );
            }
        }
    } catch (error) {
        finishBridgeSession(isTaskCancelled(error) ? "cancelled" : "failed", {
            reason: String(error),
            count: total.succeeded,
            failed: total.failed,
        });
        throw error;
    }
    return total;
}

function addReadResult(target: ReadResult, result: ReadResult): void {
    target.total += result.total;
    target.succeeded += result.succeeded;
    target.failed += result.failed;
}
