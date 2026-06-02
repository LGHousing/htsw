/// <reference types="../../../CTAutocomplete" />

/**
 * GUI-driving implementation of `ExportProgressSink`. Reuses the import
 * progress strip + queue (with the verb swapped to "export") so a command
 * export shows the same bottom strip + "Now: <name>" summary an import
 * does. Progress is coarse — one unit per exported importable, no
 * per-op/phase detail — which is why every row is rendered in the
 * "applying" phase color.
 */

import type { Importable } from "htsw/types";

import type { ImportableEntry, ImportProgressActive } from "../../importer/progress/types";
import { importProgressKey } from "../../importer/progress/keys";
import { setImportRunning } from "../../importer/runtimeState";
import type { ExportProgressSink } from "../../exporter/exportProgress";
import { createImportProgress, setImportProgress, setSessionVerb } from "./importProgress";
import { addToQueue, queueItemKey, removeFromQueueKey, type QueueItem } from "./queue";

export function createExportProgressSink(
    type: Importable["type"],
    importJsonPath: string
): ExportProgressSink {
    const queueItems: QueueItem[] = [];
    let names: readonly string[] = [];

    const keyFor = (name: string): string => importProgressKey(type, name, importJsonPath);

    const activeFor = (name: string): ImportProgressActive => ({
        key: keyFor(name),
        type,
        identity: name,
        phase: "applying",
        completedUnits: 0,
        totalUnits: 1,
        phaseUnits: { setup: 0, reading: 0, hydrating: 0, applying: 1 },
        sync: null,
    });

    const rowsUpTo = (doneCount: number): ImportableEntry[] =>
        names.map((n, i) => ({
            key: keyFor(n),
            status: i < doneCount ? "imported" : "queued",
            totalUnits: 1,
        }));

    return {
        start(ns) {
            names = ns;
            if (ns.length === 0) return;
            setSessionVerb("export");
            setImportProgress(
                createImportProgress({
                    completedUnits: 0,
                    totalUnits: Math.max(1, ns.length),
                    rows: rowsUpTo(0),
                    active: activeFor(ns[0]),
                })
            );
            for (const n of ns) {
                const item: QueueItem = {
                    kind: "importable",
                    sourcePath: importJsonPath,
                    identity: n,
                    type,
                    label: n,
                };
                queueItems.push(item);
                addToQueue(item);
            }
            setImportRunning(true);
        },
        item(index, name) {
            if (names.length === 0) return;
            setImportProgress(
                createImportProgress({
                    completedUnits: index,
                    totalUnits: Math.max(1, names.length),
                    rows: rowsUpTo(index),
                    active: activeFor(name),
                })
            );
        },
        done() {
            setImportProgress(null);
            setImportRunning(false);
            for (const it of queueItems) removeFromQueueKey(queueItemKey(it));
            queueItems.length = 0;
        },
    };
}
