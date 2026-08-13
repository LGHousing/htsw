/// <reference types="../../../CTAutocomplete" />

/**
 * GUI-driving implementation of `ExportProgressSink`: a thin adapter that
 * translates sink calls into the existing progress event stream and runs them
 * through the same reducer as import/read — one snapshot builder for every
 * task pipeline.
 *
 * Each item is sized in the SAME cost-model units the importer uses
 * (`estimateImportableCost` over its action lists), so the learned ms/unit
 * converts to a real ETA instead of pricing a whole function like one import
 * op. Content for sizing comes from the cache (post-Read/sync) or the
 * destination import.json; names with neither get the average of the rest.
 *
 * Queue membership belongs to the operation controller; this sink only owns
 * detailed progress for the active operation.
 */

import type { Importable } from "htsw/types";

import type { SyncEvent } from "../../housingSync/syncEvents";
import { queueRowKey } from "../../housingSync/progress/queueRowKey";
import { initialReducerState, reduce } from "../../housingSync/progress/reducer";
import type { ExportProgressSink } from "../../housingSync/progress/types";
import { estimateImportableReadUnits } from "../../housingSync/progress/costs";
import { readImportableCache } from "../../importCache/cache";
import { importableIdentity } from "../../importables/identity";
import { getHousingUuid } from "../state";
import { canonicalPath, requestParse } from "../parsing/parses";
import {
    setEtaEstimating,
    setTaskProgress,
    startTaskProgress,
} from "../right-panel/import-tab/taskProgress";
import { createReadLivePreview } from "../right-panel/import-tab/readLivePreview";

export function createExportProgressSink(
    type: Importable["type"],
    importJsonPath: string,
    verb: "export" | "read" = "export",
    _labels?: ReadonlyMap<string, string>
): ExportProgressSink {
    let names: readonly string[] = [];
    let units: number[] = [];
    let state = initialReducerState();
    let currentIndex: number | null = null;
    /** True once the current item reached a terminal status (failed early). */
    let currentClosed = false;
    /** True after a staged reader announces that it is scanning. */
    let stagedScanActive = false;
    let totalsLocked = false;
    const canonicalImportJsonPath = canonicalPath(importJsonPath);
    const livePreview = createReadLivePreview(type, canonicalImportJsonPath);
    const keyFor = (name: string): string =>
        queueRowKey(type, name, canonicalImportJsonPath);

    const emit = (event: SyncEvent): void => {
        state = reduce(state, event);
        setTaskProgress(state.progress);
    };

    // Exports never apply changes, so per-item costs are final once hydration
    // begins for staged reads, or immediately for direct reads. Locking then
    // lets the footer show a real total ETA instead of "total estimating…"
    // forever (only imports emit this event otherwise).
    const lockTotals = (): void => {
        if (totalsLocked) return;
        totalsLocked = true;
        emit({ kind: "sessionTotalsLocked" });
    };

    const finishCurrent = (status: "imported" | "failed", error?: string): void => {
        if (currentIndex === null || currentClosed) return;
        currentClosed = true;
        livePreview.finish(currentIndex);
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
                return Math.max(1, estimateImportableReadUnits(entry.importable));
            }
            if (sourceValues !== null) {
                for (const imp of sourceValues) {
                    if (imp.type === type && importableIdentity(imp) === name) {
                        return Math.max(1, estimateImportableReadUnits(imp));
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
        events: livePreview.events,
        eventsForList: livePreview.eventsForList,
        start(ns) {
            names = ns;
            if (ns.length === 0) return;
            const resolved = resolveUnits(ns);
            units = resolved.units;
            let total = 0;
            for (const u of units) total += u;
            const rows = ns.map((n, i) => ({
                key: keyFor(n),
                status: "queued" as const,
                totalUnits: units[i],
            }));
            state = reduce(state, {
                kind: "sessionStarted",
                rows,
                initialTotalUnits: Math.max(1, total),
            });
            startTaskProgress({
                progress: state.progress,
                verb,
                path: null,
                etaRough: resolved.knownCount === 0,
            });
            livePreview.start(ns);
        },
        scanStarted() {
            if (names.length === 0) return;
            stagedScanActive = true;
            setEtaEstimating(true);
        },
        item(index, name) {
            if (names.length === 0) return;
            currentIndex = index;
            currentClosed = false;
            livePreview.activate(index, true);
            if (!stagedScanActive) lockTotals();
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
        itemReactivated(index) {
            if (names.length === 0) return;
            currentIndex = index;
            currentClosed = false;
            livePreview.activate(index, false);
            setEtaEstimating(false);
            lockTotals();
            emit({
                kind: "importableReactivated",
                key: keyFor(names[index]),
                rowIndex: index,
                phase: "hydrating",
            });
        },
        itemFinished(index) {
            if (index === currentIndex) finishCurrent("imported");
        },
        itemProgress(index, payload) {
            if (names.length === 0 || index !== currentIndex || currentClosed) return;
            // Forward the payload's own phase and phase split — the read
            // emits honest reading/hydrating units and the reducer already
            // speaks that vocabulary; rewriting it here would fork what a
            // phase means between import and export.
            emit({
                kind: "progress",
                scope: { kind: "topLevel" },
                progress: {
                    phase: payload.phase,
                    completedUnits: Math.max(0, payload.completedUnits),
                    totalUnits: Math.max(0, payload.totalUnits, payload.completedUnits),
                    phaseUnits: payload.phaseUnits,
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
            livePreview.clear();
        },
    };
}
