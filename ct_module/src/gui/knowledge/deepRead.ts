/// <reference types="../../../CTAutocomplete" />

import type { ImportablesParseResult } from "htsw";
import type { Importable } from "htsw/types";

import { showToast } from "../toast";
import { runHousingSyncTask } from "../../housingSync/taskRunner";
import { recordHouseScan } from "../../importCache/cache";
import { projectItemsFromParsedImportJson } from "../../importables/export/projectDestination";
import type { ReadFn } from "../../importables/export/reader";
import { runExportSession } from "../../importables/export/session";
import { TaskManager } from "../../tasks/manager";

let readInFlight = false;

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
    if (specs.length === 0 || readInFlight || TaskManager.isBusy()) return;

    const summaryLabel =
        options.summaryLabel ?? (specs.length === 1 ? specs[0].label : "importable");
    readInFlight = true;
    runHousingSyncTask("export", async (ctx) => {
        try {
            return await runExportSession(
                ctx,
                {
                    kind: "cache",
                    housingUuid: options.housingUuid,
                    importJsonPath: options.importJsonPath,
                    projectItems: projectItemsFromParsedImportJson(options.parsed),
                },
                specs.map((spec) => ({
                    type: spec.type,
                    reader: spec.read,
                    names: spec.names,
                    onNamesListed: (names: readonly string[]) =>
                        recordHouseScan(options.housingUuid, spec.type, names.slice()),
                }))
            );
        } finally {
            readInFlight = false;
        }
    })
        .then((result) => {
            if (result === undefined) return;
            if (result.failed > 0) {
                showToast(
                    `Read ${result.succeeded} of ${result.total} ${summaryLabel}${result.total === 1 ? "" : "s"} (${result.failed} failed)`,
                    0xffe85c5c,
                    8000
                );
                return;
            }
            showToast(
                `Read ${result.succeeded} ${summaryLabel}${result.succeeded === 1 ? "" : "s"}`,
                0xff5cb85c
            );
            options.onSuccess?.();
        })
        .catch((err: unknown) => {
            showToast(`${summaryLabel} read failed: ${String(err)}`, 0xffe85c5c, 8000);
            ChatLib.chat(`&c[htsw] ${summaryLabel} read failed: ${String(err)}`);
        });
}
