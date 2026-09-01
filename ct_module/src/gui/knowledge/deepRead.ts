/// <reference types="../../../CTAutocomplete" />

import type { ImportablesParseResult } from "htsw";
import type { Importable } from "htsw/types";

import { showToast } from "../toast";
import type { HouseReadableType } from "../../importables/export/readers";
import {
    addQueueRow,
    makeBulkQueueRow,
    makeImportableQueueRow,
    type QueueAddResult,
} from "../right-panel/import-tab/queue";
import { autoRunQueueChanged } from "../autoRun";

export type DeepReadSpec = {
    type: Importable["type"];
    label: string;
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
    const results: QueueAddResult[] = [];
    for (const spec of specs) {
        if (spec.names === undefined) {
            results.push(
                addQueueRow(
                    makeBulkQueueRow({
                        op: "read",
                        house: options.housingUuid,
                        path: options.importJsonPath,
                        scope: {
                            kind: "houseType",
                            type: spec.type as HouseReadableType,
                        },
                        filter: "all",
                        label: `Read all ${spec.label}s`,
                    })
                )
            );
            continue;
        }
        for (const identity of spec.names) {
            results.push(
                addQueueRow(
                    makeImportableQueueRow({
                        op: "read",
                        house: options.housingUuid,
                        path: options.importJsonPath,
                        type: spec.type,
                        identity,
                        label: identity,
                    })
                )
            );
        }
    }

    let added = 0;
    for (const result of results) {
        if (result.kind === "added" || result.kind === "alsoQueuedOtherDirection") {
            added++;
        }
    }
    if (added === 0) {
        showToast(results[0]?.message ?? "That read is already queued", 0xffe5bc4b);
        return;
    }
    showToast(
        `Queued ${added} ${summaryLabel} read${added === 1 ? "" : "s"}`,
        0xff5c9ded,
        6000
    );
    options.onSuccess?.();
    autoRunQueueChanged();
}
