import type { Importable } from "htsw/types";

import { actionListsOfImportable } from "../../../importCache/actionLists";
import { importableIdentity, importableKey } from "../../../importables/identity";
import { HOUSE_READERS } from "../../../importables/export/readers";
import { estimateImportableReadUnits } from "../../../housingSync/progress/costs";
import { queueRowKey } from "../../../housingSync/progress/queueRowKey";
import { initialReducerState, reduce } from "../../../housingSync/progress/reducer";
import type { ExportProgressSink } from "../../../housingSync/progress/types";
import type { SyncEvent } from "../../../housingSync/syncEvents";
import {
    finishTaskProgress,
    setActiveTaskPath,
    setEtaEstimating,
    setSessionVerb,
    setTaskProgress,
} from "./taskProgress";

export type DiffProgressSession = {
    sinkFor(type: Importable["type"]): ExportProgressSink;
    complete(summary: string): void;
    fail(message: string): void;
    clear(): void;
};

export function createDiffProgressSession(
    importables: readonly Importable[],
    manifest: string
): DiffProgressSession {
    const tracked = importables.filter(
        (importable) =>
            actionListsOfImportable(importable).length > 0 &&
            HOUSE_READERS[importable.type] !== null
    );
    const unitsByKey = new Map<string, number>();
    const rowIndexByKey = new Map<string, number>();
    let totalUnits = 0;
    const rows = tracked.map((importable, index) => {
        const identity = importableIdentity(importable);
        const key = importableKey(importable.type, identity);
        const units = Math.max(1, estimateImportableReadUnits(importable));
        unitsByKey.set(key, units);
        rowIndexByKey.set(key, index);
        totalUnits += units;
        return {
            key: queueRowKey(importable.type, identity, manifest),
            status: "queued" as const,
            totalUnits: units,
        };
    });

    let state = initialReducerState();
    const emit = (event: SyncEvent): void => {
        state = reduce(state, event);
        setTaskProgress(state.progress);
    };
    emit({
        kind: "sessionStarted",
        rows,
        initialTotalUnits: Math.max(1, totalUnits),
    });
    setSessionVerb("diff");
    setActiveTaskPath(manifest);

    return {
        sinkFor(type) {
            let names: readonly string[] = [];
            let currentIndex: number | null = null;
            let scanPass = false;
            const rowKeyFor = (name: string): string => queueRowKey(type, name, manifest);
            return {
                start(batchNames) {
                    names = batchNames;
                },
                scanStarted() {
                    scanPass = true;
                    setEtaEstimating(true);
                },
                item(index, name) {
                    currentIndex = index;
                    const key = importableKey(type, name);
                    emit({
                        kind: "importableStarted",
                        key: rowKeyFor(name),
                        type,
                        identity: name,
                        setupUnits: 0,
                        initialUnits: unitsByKey.get(key) ?? 1,
                        rowIndex: rowIndexByKey.get(key) ?? 0,
                        cached: null,
                    });
                    if (!scanPass) emit({ kind: "sessionTotalsLocked" });
                },
                itemReactivated(index) {
                    currentIndex = index;
                    const name = names[index];
                    const key = importableKey(type, name);
                    setEtaEstimating(false);
                    emit({ kind: "sessionTotalsLocked" });
                    emit({
                        kind: "importableReactivated",
                        key: rowKeyFor(name),
                        rowIndex: rowIndexByKey.get(key) ?? 0,
                        phase: "hydrating",
                    });
                },
                itemProgress(index, progress) {
                    if (index !== currentIndex) return;
                    emit({
                        kind: "progress",
                        scope: { kind: "topLevel" },
                        progress: {
                            ...progress,
                            preserveApplyingEstimate: false,
                        },
                    });
                },
                itemFinished(index) {
                    emit({
                        kind: "importableFinished",
                        key: rowKeyFor(names[index]),
                        status: "imported",
                    });
                },
                itemFailed(index, error) {
                    emit({
                        kind: "importableFinished",
                        key: rowKeyFor(names[index]),
                        status: "failed",
                        error,
                    });
                },
                done() {},
            };
        },
        complete(summary) {
            emit({ kind: "sessionFinished" });
            setActiveTaskPath(null);
            finishTaskProgress(null, {
                title: "Diff complete",
                message: summary,
            });
        },
        fail(message) {
            setActiveTaskPath(null);
            finishTaskProgress(message);
        },
        clear() {
            setActiveTaskPath(null);
            setTaskProgress(null);
        },
    };
}
