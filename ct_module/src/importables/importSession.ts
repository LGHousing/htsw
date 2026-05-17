import { Diagnostic, SourceMap, parseImportablesResult } from "htsw";
import type { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import { isTaskCancelled } from "../tasks/manager";
import { FileSystemFileLoader } from "../utils/files";
import { buildKnowledgeTrustPlan, importableIdentity, trustPlanKey } from "../knowledge";
import { printDiagnostic } from "../tui/diagnostics";
import { createItemRegistry } from "./itemRegistry";
import { importImportable } from "./imports";
import { setActiveDiffSink, type ImportDiffSink } from "../importer/diffSink";
import type {
    ActionListProgressFields,
    ImportProgress,
    ImportProgressCurrent,
    ImportProgressRow,
    ImportRunRowStatus,
    PhaseUnits,
} from "../importer/progress/types";
import { estimateImportableCost } from "../importer/progress/costs";
import { readKnowledge } from "../knowledge/cache";
import { readCachedActionList } from "./actionListTrust";

export type ImportSelection = {
    importables: Importable[];
    trustMode: boolean;
    housingUuid: string;
    sourcePath: string;
    /**
     * Optional progress callback fired *before* each importable is processed
     * and once on completion. Lets a UI (e.g. the dashboard overlay) reflect
     * how far through the import we are.
     */
    onProgress?: (progress: ImportProgress) => void;
    /**
     * Optional factory the session calls before each importable to obtain a
     * per-importable diff sink. When non-null, the sink receives action-level
     * events (`markMatch` / `beginOp` / `completeOp` / `end`) as the importer
     * walks the action list — driving the live HTSL diff view above the
     * inventory. The session sets/clears the active sink around each
     * importable so events route to the right listener.
     */
    diffSinkForImportable?: (
        importable: Importable,
        sourcePath: string | null
    ) => ImportDiffSink | null;
};

export type ImportSessionResult = {
    imported: number;
    skippedTrusted: number;
    failed: number;
};

export function orderImportablesForImportSession(
    allImportables: readonly Importable[],
    selectedImportables: readonly Importable[]
): Importable[] {
    const selectedKeys = new Set(
        selectedImportables.map((importable) =>
            trustPlanKey(importable.type, importableIdentity(importable))
        )
    );
    return [
        ...allImportables.filter((i) => i.type === "ITEM"),
        ...allImportables.filter((i) => i.type !== "ITEM"),
    ].filter((importable) =>
        selectedKeys.has(trustPlanKey(importable.type, importableIdentity(importable)))
    );
}

export async function importSelectedImportables(
    ctx: TaskContext,
    selection: ImportSelection
): Promise<ImportSessionResult> {
    const sm = new SourceMap(new FileSystemFileLoader());
    const parsed = parseImportablesResult(sm, selection.sourcePath);
    const registry = createItemRegistry(parsed.value, parsed.gcx);
    const ordered = orderImportablesForImportSession(parsed.value, selection.importables);
    const trustPlan = buildKnowledgeTrustPlan(
        selection.housingUuid,
        parsed.value,
        selection.trustMode
    );

    const result: ImportSessionResult = {
        imported: 0,
        skippedTrusted: 0,
        failed: 0,
    };

    const importableUnits: number[] = ordered.map((importable) =>
        estimateImportableUnitsWithCache(importable, selection.housingUuid)
    );
    let initialTotalUnits = 0;
    for (let i = 0; i < importableUnits.length; i++) {
        initialTotalUnits += importableUnits[i];
    }
    if (initialTotalUnits === 0) initialTotalUnits = 1;
    let completed = 0;
    let completedSessionUnits = 0;
    let totalSessionUnits = initialTotalUnits;
    let lastEmittedSessionUnits = 0;
    const rows: ImportProgressRow[] = ordered.map((importable, i) => {
        const identity = importableIdentity(importable);
        return {
            key: trustPlanKey(importable.type, identity),
            status: "queued",
            units: importableUnits[i],
        };
    });

    for (let i = 0; i < ordered.length; i++) {
        const importable = ordered[i];
        const initialCurrentUnits = importableUnits[i];
        const identity = importableIdentity(importable);
        const importableKey = trustPlanKey(importable.type, identity);
        const plan = trustPlan?.importables.get(importableKey);
        let currentTotalUnits = initialCurrentUnits;
        let currentCompletedUnits = 0;
        let currentPhaseUnits: PhaseUnits = {
            reading: 0,
            hydrating: 0,
            applying: currentTotalUnits,
        };
        const finishCurrentUnits = (): void => {
            totalSessionUnits += currentTotalUnits - initialCurrentUnits;
            importableUnits[i] = currentTotalUnits;
            rows[i].units = currentTotalUnits;
        };
        const finishCompletedImportable = (): void => {
            finishCurrentUnits();
            completed++;
            completedSessionUnits += currentTotalUnits;
        };
        const finishFailedImportable = (): void => {
            finishCurrentUnits();
        };
        const emitProgress = (inner: ActionListProgressFields): void => {
            const eventTotalUnits =
                inner.totalUnits > 0 ? inner.totalUnits : initialCurrentUnits;
            if (eventTotalUnits > currentTotalUnits) {
                currentTotalUnits = eventTotalUnits;
                rows[i].units = currentTotalUnits;
            }

            currentPhaseUnits = inner.phaseUnits;
            currentCompletedUnits = Math.min(
                currentTotalUnits,
                Math.max(currentCompletedUnits, inner.completedUnits)
            );
            emitSessionProgress("current", inner.phase, inner.phaseLabel, inner);
        };
        const emitTerminalProgress = (
            rowStatus: Extract<ImportRunRowStatus, "imported" | "skipped" | "failed">,
            phaseLabel: string
        ): void => {
            currentCompletedUnits = currentTotalUnits;
            emitSessionProgress(rowStatus, "done", phaseLabel);
        };
        // Update row state without emitting a "done" event — used between
        // importables so the GUI doesn't flash a "Done: imported" line
        // before the next importable's first phase event arrives. The
        // next emit (or the session-end emit) carries the updated rows
        // array to the GUI, which is what flips the queue row green.
        const finishImportableRowSilently = (
            rowStatus: Extract<ImportRunRowStatus, "imported" | "skipped">
        ): void => {
            currentCompletedUnits = currentTotalUnits;
            rows[i].status = rowStatus;
        };
        const emitSessionProgress = (
            rowStatus: Exclude<ImportRunRowStatus, "queued">,
            phase: ImportProgressCurrent["phase"],
            phaseLabel: string,
            inner?: ActionListProgressFields
        ): void => {
            rows[i].status = rowStatus;
            const clampedCurrentUnits = Math.min(
                currentTotalUnits,
                Math.max(0, currentCompletedUnits)
            );
            currentCompletedUnits = clampedCurrentUnits;
            if (!selection.onProgress) return;

            const remainingSessionUnits =
                totalSessionUnits - completedSessionUnits - initialCurrentUnits;
            const sessionCompletedUnits = completedSessionUnits + clampedCurrentUnits;
            const sessionTotalUnits =
                completedSessionUnits + currentTotalUnits + remainingSessionUnits;
            const current: ImportProgressCurrent = {
                key: importableKey,
                type: importable.type,
                identity,
                status: rowStatus,
                phase,
                label: `${importable.type} ${identity}`,
                phaseLabel,
                completedUnits: clampedCurrentUnits,
                totalUnits: currentTotalUnits,
                phaseUnits: currentPhaseUnits,
                unitCompleted: inner?.unitCompleted,
                unitTotal: inner?.unitTotal,
                parentUnitCompleted: inner?.parentUnitCompleted,
                parentUnitTotal: inner?.parentUnitTotal,
                parentPhaseLabel: inner?.parentPhaseLabel,
            };
            const payload: ImportProgress = {
                completedImportables: completed,
                totalImportables: ordered.length,
                completedUnits: sessionCompletedUnits,
                totalUnits: sessionTotalUnits,
                current,
                rows,
                failed: result.failed,
            };
            selection.onProgress(payload);
            lastEmittedSessionUnits = Math.max(
                lastEmittedSessionUnits,
                payload.completedUnits
            );
        };

        if (plan?.wholeImportableTrusted) {
            result.skippedTrusted++;
            finishImportableRowSilently("skipped");
            finishCompletedImportable();
            continue;
        }

        const sourcePath = parsed.gcx.sourceFiles.get(importable) ?? null;
        const sink = selection.diffSinkForImportable
            ? selection.diffSinkForImportable(importable, sourcePath)
            : null;
        setActiveDiffSink(sink);
        try {
            await importImportable(ctx, importable, registry, {
                plan,
                housingUuid: selection.housingUuid,
                onActionListProgress: emitProgress,
            });
            if (!plan?.wholeImportableTrusted) {
                result.imported++;
            }
            finishImportableRowSilently("imported");
            finishCompletedImportable();
        } catch (error) {
            // User-initiated cancel — propagate so TaskManager logs "Task
            // cancelled" once and the GUI's progress UI clears, instead of
            // surfacing "Failed to import ...: [object Object]".
            if (isTaskCancelled(error)) {
                setActiveDiffSink(null);
                throw error;
            }
            result.failed++;
            emitTerminalProgress("failed", "failed");
            if (error instanceof Diagnostic) {
                printDiagnostic(sm, error);
            } else {
                ctx.displayMessage(`&cFailed to import ${importable.type}: ${error}`);
            }
            // Halt the session on first failure rather than ploughing
            // through the remaining importables — they're often dependent
            // on each other and a partial import is worse than a clean
            // abort. The user can fix the failing importable and retry.
            ctx.displayMessage(
                `&c[htsw] Import aborted after failure on ${importable.type} ${importableIdentity(importable)}`
            );
            setActiveDiffSink(null);
            finishFailedImportable();
            break;
        } finally {
            setActiveDiffSink(null);
        }
    }

    if (selection.onProgress) {
        const finalSessionUnits = Math.max(
            completedSessionUnits,
            lastEmittedSessionUnits
        );
        selection.onProgress({
            completedImportables: completed,
            totalImportables: ordered.length,
            completedUnits: finalSessionUnits,
            totalUnits: totalSessionUnits,
            current: null,
            rows,
            failed: result.failed,
        });
    }

    return result;
}

/**
 * Cache-aware work estimate for an importable, in progress units.
 */
function estimateImportableUnitsWithCache(
    importable: Importable,
    housingUuid: string
): number {
    const entry = readKnowledge(
        housingUuid,
        importable.type,
        importableIdentity(importable)
    );
    if (entry === null) {
        return Math.max(1, estimateImportableCost(importable));
    }
    const getCached = (basePath: string) =>
        readCachedActionList(entry.importable, basePath);
    return Math.max(1, estimateImportableCost(importable, getCached));
}
