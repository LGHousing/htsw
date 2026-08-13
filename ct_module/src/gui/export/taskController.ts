/// <reference types="../../../CTAutocomplete" />

import type { Importable } from "htsw/types";

import { getHousingUuid, getNewExportTarget } from "../state";
import { markParseStale, parseImportJsonBlocking } from "../parsing/parses";
import type { ReadFn } from "../../importables/export/reader";
import { projectExportDestinationFromParsedImportJson } from "../../importables/export/projectDestination";
import { isTaskCancelled } from "../../tasks/manager";
import { closeAllPopovers } from "../lib/popovers";
import { shortPath } from "../lib/pathDisplay";
import { createExportProgressSink } from "./progressSink";
import { showToast } from "../toast";
import { runHousingSyncTask } from "../../housingSync/taskRunner";
import { getExportDestinationStatus } from "./destinationStatus";
import { writeTaskFailureLog } from "../../runtimeDebug/importFailureLog";
import { HOUSE_READERS } from "../../importables/export/readers";
import { exportHeldItem } from "../../importables/items/export";
import { recordHouseScan } from "../../importCache/cache";
import { getCurrentHousingUuid } from "../../importCache/housingId";
import {
    addToQueueDetailed,
    makeExportQueueItem,
    type ExportQueueItem,
    type QueueExecutionResult,
} from "../right-panel/import-tab/queue";

export type ExportSpec = {
    type: Importable["type"];
    label: string;
    read: ReadFn;
};

export function startExport(
    spec: ExportSpec,
    names?: readonly string[],
    onSuccess?: () => void,
    labels?: ReadonlyMap<string, string>
): void {
    closeAllPopovers();
    const destination = getExportDestinationStatus();
    if (destination.kind === "none") {
        showToast(
            "Export stopped — choose or create an export project first",
            0xffe85c5c,
            8000
        );
        return;
    }
    if (destination.kind === "missing") {
        showToast(
            "Export stopped — the selected project no longer exists",
            0xffe85c5c,
            8000
        );
        ChatLib.chat("&c[htsw] Export stopped: the selected project no longer exists.");
        ChatLib.chat(`&7  ${destination.path}`);
        ChatLib.chat("&7Choose another project from Houses → Export project.");
        return;
    }
    const importJsonPath = destination.path;
    if (names !== undefined && names.length === 0) {
        showToast("Nothing selected to export", 0xffe5bc4b);
        return;
    }
    const housingUuid = getHousingUuid();
    const queueItems =
        names === undefined
            ? [
                  makeExportQueueItem(
                      "export",
                      spec.type,
                      spec.type === "ITEM" ? "held item" : "*",
                      importJsonPath,
                      housingUuid,
                      spec.type === "ITEM" ? "Held item" : `All ${spec.label}s`,
                      spec.type !== "ITEM"
                  ),
              ]
            : names.map((name) =>
                  makeExportQueueItem(
                      "export",
                      spec.type,
                      name,
                      importJsonPath,
                      housingUuid,
                      labels?.get(name) ?? name
                  )
              );
    let added = 0;
    let blocked = 0;
    for (let i = 0; i < queueItems.length; i++) {
        const result = addToQueueDetailed(queueItems[i]);
        if (result.kind === "added") added++;
        else if (result.kind === "blocked") blocked++;
    }
    if (added > 0 || blocked > 0) {
        showToast(
            blocked > 0
                ? `Queued ${added} export${added === 1 ? "" : "s"}; ${blocked} blocked by conflicting work`
                : `Queued ${added} export${added === 1 ? "" : "s"} → ${shortPath(importJsonPath)}`,
            blocked > 0 ? 0xffe5bc4b : 0xff5c9ded,
            6000
        );
        if (added > 0) onSuccess?.();
    } else {
        showToast("That export is already queued", 0xffe5bc4b);
    }
}

export async function runQueuedExport(
    item: ExportQueueItem
): Promise<QueueExecutionResult> {
    const reader = item.type === "ITEM" ? exportHeldItem : HOUSE_READERS[item.type];
    const importJsonPath = item.destinationPath;
    const dir = importJsonDir(importJsonPath);
    const newExportTarget = getNewExportTarget();
    const labels = new Map<string, string>();
    const housingUuid = item.housingUuid;
    if (!item.all) labels.set(item.identity, item.label);
    try {
        const result = await runHousingSyncTask("export", async (ctx) => {
            const currentHousingUuid = await getCurrentHousingUuid(ctx);
            if (housingUuid !== null && currentHousingUuid !== housingUuid) {
                throw new Error(
                    `Queued for house ${housingUuid}, but you are now in ${currentHousingUuid}`
                );
            }
            const exportContext = projectExportDestinationFromParsedImportJson(
                { rootDir: dir, importJsonPath },
                parseImportJsonBlocking(importJsonPath).parsed
            );
            return await reader(ctx, {
                ...exportContext,
                output: { kind: "project" },
                ...(newExportTarget !== null
                    ? { newExportTargetImportJson: newExportTarget }
                    : {}),
                names: item.all ? undefined : [item.identity],
                ...(item.all && housingUuid !== null
                    ? {
                          onNamesListed: (names: readonly string[]) =>
                              recordHouseScan(housingUuid, item.type, names.slice()),
                      }
                    : {}),
                progress: createExportProgressSink(
                    item.type,
                    importJsonPath,
                    "export",
                    labels
                ),
            });
        });
        markParseStale(importJsonPath);
        if (result === undefined) {
            showToast(`Export cancelled · ${item.label}`, 0xffe5bc4b, 6000);
            return { kind: "cancelled" };
        }
        if (result.failed > 0) {
            showToast(
                `Export failed · ${item.label} · ${result.failed} failed`,
                0xffe85c5c,
                8000
            );
            return {
                kind: "failed",
                error: `${result.failed} export${result.failed === 1 ? "" : "s"} failed`,
            };
        }
        showToast(
            result.total === 0
                ? `No ${item.label.toLowerCase()} found to export`
                : `Exported ${item.label} → ${shortPath(importJsonPath)}`,
            result.total === 0 ? 0xffe5bc4b : 0xff5cb85c
        );
        return { kind: "success" };
    } catch (error) {
        if (!isTaskCancelled(error)) {
            writeTaskFailureLog(
                {
                    phase: "export",
                    sourcePath: importJsonPath,
                    housingUuid: item.housingUuid ?? "",
                    importableType: item.type,
                },
                error
            );
        }
        showToast(`Export failed · ${item.label}: ${String(error)}`, 0xffe85c5c, 8000);
        return isTaskCancelled(error)
            ? { kind: "cancelled" }
            : { kind: "failed", error: String(error) };
    }
}

function importJsonDir(path: string): string {
    const norm = path.split("\\").join("/");
    const slash = norm.lastIndexOf("/");
    if (slash <= 0) return ".";
    return norm.substring(0, slash);
}
