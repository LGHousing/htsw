/// <reference types="../../../../CTAutocomplete" />

import type { Importable } from "htsw/types";

import type { HouseReadableType } from "../../../importables/export/readers";
import { autoRunQueueChanged } from "../../autoRun";
import { shortPath } from "../../lib/pathDisplay";
import {
    addQueueRow,
    makeBulkQueueRow,
    makeImportableQueueRow,
    type BulkFilter,
    type QueueAddResult,
    type QueueRow,
} from "../../right-panel/import-tab/queue";
import { showToast } from "../../toast";

export type HouseQueueTarget = { identity: string; label?: string };

function wasAdded(result: QueueAddResult): boolean {
    return result.kind === "added" || result.kind === "alsoQueuedOtherDirection";
}

function enqueueRows(
    rows: readonly QueueRow[],
    successMessage: (added: number) => string,
    onAdded?: () => void
): void {
    const results = rows.map((row) => addQueueRow(row));
    let added = 0;
    for (const result of results) {
        if (wasAdded(result)) added++;
    }
    if (added === 0) {
        showToast(results[0]?.message ?? "Nothing to queue", 0xffe5bc4b);
        return;
    }
    onAdded?.();
    showToast(successMessage(added), 0xff5c9ded, 6000);
    autoRunQueueChanged();
}

export function enqueueHouseConcrete(args: {
    op: "read" | "export";
    house: string;
    path: string;
    type: Importable["type"];
    singularLabel: string;
    targets: readonly HouseQueueTarget[];
    onAdded?: () => void;
}): void {
    const rows = args.targets.map((target) =>
        makeImportableQueueRow({
            op: args.op,
            house: args.house,
            path: args.path,
            type: args.type,
            identity: target.identity,
            label: target.label ?? target.identity,
        })
    );
    enqueueRows(
        rows,
        (added) =>
            args.op === "read"
                ? `Queued ${added} ${args.singularLabel} read${added === 1 ? "" : "s"}`
                : `Queued ${added} export${added === 1 ? "" : "s"} → ${shortPath(args.path)}`,
        args.onAdded
    );
}

export function enqueueHouseBulk(args: {
    op: "read" | "export";
    house: string;
    path: string;
    type: HouseReadableType;
    filter: Extract<BulkFilter, "all" | "new" | "changed" | "unread">;
    label: string;
}): void {
    const row = makeBulkQueueRow({
        op: args.op,
        house: args.house,
        path: args.path,
        scope: { kind: "houseType", type: args.type },
        filter: args.filter,
        label: args.label,
    });
    enqueueRows([row], () => `Queued ${args.label}`);
}

export function enqueueWholeHouse(args: {
    house: string;
    path: string;
    types: readonly { type: HouseReadableType; pluralLabel: string }[];
}): void {
    const rows = args.types.map(({ type, pluralLabel }) =>
        makeBulkQueueRow({
            op: "export",
            house: args.house,
            path: args.path,
            scope: { kind: "houseType", type },
            filter: "all",
            label: `Export all ${pluralLabel.toLowerCase()}`,
        })
    );
    enqueueRows(rows, (added) =>
        added === rows.length
            ? "Queued whole-house export"
            : `Queued ${added} whole-house export group${added === 1 ? "" : "s"}`
    );
}
