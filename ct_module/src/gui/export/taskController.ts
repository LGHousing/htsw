/// <reference types="../../../CTAutocomplete" />

import type { Importable } from "htsw/types";

import { getHousingUuid } from "../state";
import { getAutoRun } from "../../settings";
import { closeAllPopovers } from "../lib/popovers";
import { shortPath } from "../lib/pathDisplay";
import { showToast } from "../toast";
import { getExportDestinationStatus } from "./destinationStatus";
import {
    addQueueRow,
    makeBulkQueueRow,
    makeImportableQueueRow,
    type QueueAddResult,
} from "../right-panel/import-tab/queue";
import { autoRunQueueChanged } from "../autoRun";

export type ExportSpec = {
    type: Importable["type"];
    label: string;
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
    if (housingUuid === null) {
        showToast("Export stopped — enter a Housing house first", 0xffe85c5c, 8000);
        return;
    }
    const results: QueueAddResult[] = [];
    if (names === undefined && spec.type !== "ITEM") {
        results.push(
            addQueueRow(
                makeBulkQueueRow({
                    op: "export",
                    house: housingUuid,
                    path: importJsonPath,
                    scope: { kind: "houseType", type: spec.type },
                    filter: "all",
                    label: `Export all ${spec.label}s`,
                })
            )
        );
    } else {
        const identities = names ?? ["held item"];
        for (const identity of identities) {
            results.push(
                addQueueRow(
                    makeImportableQueueRow({
                        op: "export",
                        house: housingUuid,
                        path: importJsonPath,
                        type: spec.type,
                        identity,
                        label:
                            spec.type === "ITEM"
                                ? "Held item (at run time)"
                                : (labels?.get(identity) ?? identity),
                    })
                )
            );
        }
    }

    let added = 0;
    for (const result of results) {
        if (result.kind === "added") added++;
    }
    if (added === 0) {
        showToast(results[0]?.message ?? "That export is already queued", 0xffe5bc4b);
        return;
    }
    showToast(
        spec.type === "ITEM" && !getAutoRun()
            ? `Queued Held item (at run time) → ${shortPath(importJsonPath)}`
            : `Queued ${added} export${added === 1 ? "" : "s"} → ${shortPath(importJsonPath)}`,
        0xff5c9ded,
        6000
    );
    onSuccess?.();
    autoRunQueueChanged();
}
