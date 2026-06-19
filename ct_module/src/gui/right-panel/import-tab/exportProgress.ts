/// <reference types="../../../../CTAutocomplete" />

/**
 * GUI-driving implementation of `ExportProgressSink`: a thin adapter that
 * translates sink calls into the importer's `ImportEvent`s and runs them
 * through the SAME progress reducer the import session uses — one snapshot
 * builder for both pipelines (parking, failure rows, monotonic clamping all
 * come from the reducer, not re-implemented here).
 *
 * Each item is sized in the SAME cost-model units the importer uses
 * (`estimateImportableCost` over its action lists), so the learned ms/unit
 * converts to a real ETA instead of pricing a whole function like one import
 * op. Content for sizing comes from the cache (post-Read/sync) or the
 * destination import.json; names with neither get the average of the rest.
 *
 * The sink also mirrors the batch into the queue UI (rows appear at start,
 * clear at done) because item names are only known once the batch lists them.
 * The import-running flag is NOT owned here — the session initiator
 * (startExport / deep read) owns its own task lifecycle.
 */

import type { Importable } from "htsw/types";

import type { ImportEvent } from "../../../housingSync/importEvents";
import { importProgressKey } from "../../../housingSync/progress/keys";
import { initialReducerState, reduce } from "../../../housingSync/progress/reducer";
import type { ExportProgressSink } from "../../../housingSync/progress/types";
import { estimateImportableCost } from "../../../housingSync/progress/costs";
import { readImportableCache } from "../../../importCache/cache";
import { importableIdentity } from "../../../importCache/paths";
import { getHousingUuid } from "../../state";
import { canonicalPath, requestParse } from "../../parsing/parses";
import { setEtaRough, setImportProgress, setSessionVerb } from "./importProgress";
import {
    addToQueue,
    makeExportQueueItem,
    queueItemKey,
    removeFromQueueKey,
    type QueueItem,
} from "./queue";

export function createExportProgressSink(
    type: Importable["type"],
    importJsonPath: string,
    verb: "export" | "read" = "export"
): ExportProgressSink {
    const queueItems: QueueItem[] = [];
    let names: readonly string[] = [];
    let units: number[] = [];
    let state = initialReducerState();
    let currentIndex: number | null = null;
    /** True once the current item reached a terminal status (failed early). */
    let currentClosed = false;

    const canonicalImportJsonPath = canonicalPath(importJsonPath);
    const keyFor = (name: string): string =>
        importProgressKey(type, name, canonicalImportJsonPath);

    const emit = (event: ImportEvent): void => {
        state = reduce(state, event);
        setImportProgress(state.progress);
    };

    const finishCurrent = (status: "imported" | "failed", error?: string): void => {
        if (currentIndex === null || currentClosed) return;
        currentClosed = true;
        emit({
            kind: "importableFinished",
            key: keyFor(names[currentIndex]),
            status,
            ...(error !== undefined ? { error } : {}),
        });
    };

    // Size each name in cost-model units from its known content — the cache
    // first (house truth after a Read/sync), else the destination import.json.
    // Unknowns get the average of the known ones so they don't read as 1 unit.
    const resolveUnits = (
        ns: readonly string[]
    ): { units: number[]; knownCount: number } => {
        const uuid = getHousingUuid();
        let sourceValues: readonly Importable[] | null = null;
        if (importJsonPath.trim() !== "") {
            const parse = requestParse(importJsonPath);
            sourceValues =
                parse !== null && parse.parsed !== null ? parse.parsed.value : null;
        }
        const known: (number | null)[] = ns.map((name) => {
            const entry = uuid !== null ? readImportableCache(uuid, type, name) : null;
            if (entry !== null) {
                return Math.max(1, estimateImportableCost(entry.importable));
            }
            if (sourceValues !== null) {
                for (const imp of sourceValues) {
                    if (imp.type === type && importableIdentity(imp) === name) {
                        return Math.max(1, estimateImportableCost(imp));
                    }
                }
            }
            return null;
        });
        let sum = 0;
        let count = 0;
        for (const v of known) {
            if (v !== null) {
                sum += v;
                count++;
            }
        }
        const fallback = count > 0 ? sum / count : 1;
        return {
            units: known.map((v) => Math.max(1, Math.round(v ?? fallback))),
            knownCount: count,
        };
    };

    return {
        start(ns) {
            names = ns;
            if (ns.length === 0) return;
            const resolved = resolveUnits(ns);
            units = resolved.units;
            let total = 0;
            for (const u of units) total += u;
            emit({
                kind: "sessionStarted",
                rows: ns.map((n, i) => ({
                    key: keyFor(n),
                    status: "queued" as const,
                    totalUnits: units[i],
                })),
                initialTotalUnits: Math.max(1, total),
            });
            // After the first emit: the null→non-null progress transition
            // resets verb/rough to their import defaults, so set them last.
            setSessionVerb(verb);
            setEtaRough(resolved.knownCount === 0);
            for (const n of ns) {
                const item = makeExportQueueItem(
                    verb,
                    type,
                    n,
                    importJsonPath,
                    getHousingUuid()
                );
                queueItems.push(item);
                addToQueue(item);
            }
        },
        item(index, name) {
            if (names.length === 0) return;
            finishCurrent("imported");
            currentIndex = index;
            currentClosed = false;
            emit({
                kind: "importableStarted",
                key: keyFor(name),
                type,
                identity: name,
                setupUnits: 0,
                initialUnits: Math.max(1, units[index] ?? 1),
                rowIndex: index,
                cached: null,
            });
        },
        itemProgress(index, payload) {
            if (names.length === 0 || index !== currentIndex || currentClosed) return;
            const knownReadUnits = Math.max(0, payload.totalUnits, payload.completedUnits);
            emit({
                kind: "progress",
                scope: { kind: "topLevel" },
                progress: {
                    phase: "reading",
                    completedUnits: Math.max(0, payload.completedUnits),
                    totalUnits: knownReadUnits,
                    phaseUnits: { setup: 0, reading: knownReadUnits, hydrating: 0, applying: 0 },
                    sync: payload.sync,
                    preserveApplyingEstimate: false,
                },
            });
        },
        itemFailed(index, error) {
            if (index !== currentIndex) return;
            finishCurrent("failed", error);
        },
        done() {
            if (names.length > 0) {
                finishCurrent("imported");
                emit({ kind: "sessionFinished" });
            }
            setImportProgress(null);
            for (const it of queueItems) removeFromQueueKey(queueItemKey(it));
            queueItems.length = 0;
        },
    };
}
