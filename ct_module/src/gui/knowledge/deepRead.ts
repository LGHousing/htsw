/// <reference types="../../../CTAutocomplete" />

import type { ImportablesParseResult } from "htsw";
import type { Importable } from "htsw/types";

import { showToast } from "../toast";
import { runHousingSyncTask } from "../../housingSync/taskRunner";
import { recordHouseScan } from "../../importCache/cache";
import { projectItemsFromParsedImportJson } from "../../importables/export/projectDestination";
import type { ReadFn } from "../../importables/export/reader";
import { runExportSession } from "../../importables/export/session";
import { isTaskCancelled } from "../../tasks/manager";
import { writeTaskFailureLog } from "../../runtimeDebug/importFailureLog";
import { HOUSE_READERS } from "../../importables/export/readers";
import { parseImportJsonBlocking } from "../parsing/parses";
import { getCurrentHousingUuid } from "../../importCache/housingId";
import {
    addToQueueDetailed,
    makeExportQueueItem,
    type ExportQueueItem,
    type QueueExecutionResult,
} from "../right-panel/import-tab/queue";

export type DeepReadSpec = {
    type: Importable["type"];
    label: string;
    read: ReadFn;
    names?: readonly string[];
};

export function startDeepRead(
    specs: readonly DeepReadSpec[],
    options: {
        housingUuid: string;
        importJsonPath: string;
        parsed: ImportablesParseResult | null | undefined;
        summaryLabel?: string;
        onSuccess?: () => void;
    }
): void {
    if (specs.length === 0) return;

    const summaryLabel =
        options.summaryLabel ?? (specs.length === 1 ? specs[0].label : "importable");
    let added = 0;
    let blocked = 0;
    for (let i = 0; i < specs.length; i++) {
        const spec = specs[i];
        const names = spec.names;
        const queueItems =
            names === undefined
                ? [
                      makeExportQueueItem(
                          "read",
                          spec.type,
                          "*",
                          options.importJsonPath,
                          options.housingUuid,
                          `All ${spec.label}s`,
                          true
                      ),
                  ]
                : names.map((name) =>
                      makeExportQueueItem(
                          "read",
                          spec.type,
                          name,
                          options.importJsonPath,
                          options.housingUuid,
                          name
                      )
                  );
        for (let j = 0; j < queueItems.length; j++) {
            const result = addToQueueDetailed(queueItems[j]);
            if (result.kind === "added") added++;
            else if (result.kind === "blocked") blocked++;
        }
    }
    if (added > 0 || blocked > 0) {
        showToast(
            blocked > 0
                ? `Queued ${added} read${added === 1 ? "" : "s"}; ${blocked} blocked by conflicting work`
                : `Queued ${added} ${summaryLabel} read${added === 1 ? "" : "s"}`,
            blocked > 0 ? 0xffe5bc4b : 0xff5c9ded,
            6000
        );
        options.onSuccess?.();
    } else {
        showToast("That read is already queued", 0xffe5bc4b);
    }
}

export async function runQueuedRead(
    item: ExportQueueItem
): Promise<QueueExecutionResult> {
    if (item.housingUuid === null) {
        return { kind: "failed", error: "The queued read has no Housing target" };
    }
    const housingUuid = item.housingUuid;
    const reader = HOUSE_READERS[item.type];
    if (reader === null) {
        return { kind: "failed", error: `${item.type} has no live Housing reader` };
    }
    try {
        const parsed = parseImportJsonBlocking(item.destinationPath).parsed;
        const result = await runHousingSyncTask("read", async (ctx) => {
            const currentHousingUuid = await getCurrentHousingUuid(ctx);
            if (currentHousingUuid !== housingUuid) {
                throw new Error(
                    `Queued for house ${housingUuid}, but you are now in ${currentHousingUuid}`
                );
            }
            return await runExportSession(
                ctx,
                {
                    kind: "cache",
                    housingUuid,
                    importJsonPath: item.destinationPath,
                    projectItems: projectItemsFromParsedImportJson(parsed),
                },
                [
                    {
                        type: item.type,
                        reader,
                        names: item.all ? undefined : [item.identity],
                        onNamesListed: (names: readonly string[]) =>
                            recordHouseScan(housingUuid, item.type, names.slice()),
                    },
                ]
            );
        });
        if (result === undefined) {
            showToast(`Read cancelled · ${item.label}`, 0xffe5bc4b, 6000);
            return { kind: "cancelled" };
        }
        if (result.failed > 0) {
            showToast(
                `Read failed · ${item.label} · ${result.failed} failed`,
                0xffe85c5c,
                8000
            );
            return {
                kind: "failed",
                error: `${result.failed} read${result.failed === 1 ? "" : "s"} failed`,
            };
        }
        showToast(`Read ${item.label}`, 0xff5cb85c);
        return { kind: "success" };
    } catch (error) {
        if (!isTaskCancelled(error)) {
            writeTaskFailureLog(
                {
                    phase: "deep-read",
                    sourcePath: item.destinationPath,
                    housingUuid: item.housingUuid,
                    importableType: item.type,
                },
                error
            );
        }
        showToast(`Read failed · ${item.label}: ${String(error)}`, 0xffe85c5c, 8000);
        return isTaskCancelled(error)
            ? { kind: "cancelled" }
            : { kind: "failed", error: String(error) };
    }
}
