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
    ImportRunRowStatus,
} from "../importer/progress/types";
import { estimateImportableCost } from "../importer/progress/costs";
import { readKnowledge } from "../knowledge/cache";
import { readCachedActionList } from "./actionListTrust";
import { savePhaseStatsToDisk } from "../importer/progress/timing";

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

function terminalActionListProgress(
    phaseLabel: string,
    units: number
): ActionListProgressFields {
    return {
        phase: "done",
        phaseLabel,
        unitCompleted: 1,
        unitTotal: 1,
        estimatedCompleted: units,
        estimatedTotal: units,
        etaConfidence: "planned",
        phaseBudget: null,
    };
}

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
    // Always build the trust plan, even in non-trust mode — we want the
    // cached state for accurate phase-budget ETA estimation regardless.
    // The `trustMode` flag only controls whether matching hashes promote
    // to trustedListPaths (which skip work); when false, those stay
    // empty so nothing is skipped, but the cached snapshots still flow
    // through `actionListTrustFor` → `syncActionList`'s phase budget.
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

    // Use the knowledge cache (last-known observed state) to predict each
    // importable's apply-phase budget — even when trust mode is off. If
    // the cache says nothing changed, the predicted diff is empty and the
    // bar correctly anticipates a near-instant pass. Falls back to the
    // worst-case all-adds estimate when cache is missing for that
    // importable (e.g., first-ever import for this house).
    const weights: number[] = ordered.map((importable) =>
        estimateImportableWeightWithCache(importable, selection.housingUuid)
    );
    let weightTotal = 0;
    for (let i = 0; i < weights.length; i++) weightTotal += weights[i];
    if (weightTotal === 0) weightTotal = 1;
    let completed = 0;
    let completedSessionUnits = 0;
    let totalSessionUnits = weightTotal;
    let lastEmittedCompleted = 0;
    let lastEmittedSessionUnits = 0;

    for (let i = 0; i < ordered.length; i++) {
        const importable = ordered[i];
        const initialCurrentUnits = weights[i];
        const identity = importableIdentity(importable);
        const importableKey = trustPlanKey(importable.type, identity);
        const plan = trustPlan?.importables.get(importableKey);
        let currentTotalUnits = initialCurrentUnits;
        let currentCompletedUnits = 0;
        const finishCurrentWeight = (): void => {
            totalSessionUnits += currentTotalUnits - initialCurrentUnits;
            weights[i] = currentTotalUnits;
        };
        const finishCompletedImportable = (): void => {
            finishCurrentWeight();
            completed++;
            completedSessionUnits += currentTotalUnits;
        };
        const finishFailedImportable = (): void => {
            finishCurrentWeight();
        };
        const emitProgress = (
            inner: ActionListProgressFields,
            rowStatus: ImportRunRowStatus = "current"
        ): void => {
            const eventTotalUnits =
                inner.estimatedTotal > 0 ? inner.estimatedTotal : initialCurrentUnits;
            if (eventTotalUnits > currentTotalUnits) {
                currentTotalUnits = eventTotalUnits;
            }

            let eventCurrentUnits =
                rowStatus === "current"
                    ? inner.estimatedCompleted
                    : currentTotalUnits;
            eventCurrentUnits = Math.min(
                currentTotalUnits,
                Math.max(0, eventCurrentUnits)
            );
            if (eventCurrentUnits > currentCompletedUnits) {
                currentCompletedUnits = eventCurrentUnits;
            }
            if (!selection.onProgress) return;

            const remainingSessionUnits =
                totalSessionUnits - completedSessionUnits - initialCurrentUnits;
            const payload: ImportProgress = {
                ...inner,
                completed,
                total: ordered.length,
                weightCompleted: completedSessionUnits,
                weightTotal:
                    completedSessionUnits + currentTotalUnits + remainingSessionUnits,
                weightCurrent: currentTotalUnits,
                currentKey: importableKey,
                currentType: importable.type,
                currentIdentity: identity,
                orderIndex: i,
                rowStatus,
                currentLabel: `${importable.type} ${identity}`,
                estimatedCompleted: completedSessionUnits + currentCompletedUnits,
                estimatedTotal:
                    completedSessionUnits + currentTotalUnits + remainingSessionUnits,
                weights,
                failed: result.failed,
            };
            selection.onProgress(payload);
            lastEmittedCompleted = Math.max(lastEmittedCompleted, payload.completed);
            lastEmittedSessionUnits = Math.max(
                lastEmittedSessionUnits,
                payload.estimatedCompleted
            );
        };

        if (plan?.wholeImportableTrusted) {
            result.skippedTrusted++;
            emitProgress(
                terminalActionListProgress(
                    "trusted cache current; skipped",
                    currentTotalUnits
                ),
                "skipped"
            );
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
            emitProgress(
                terminalActionListProgress("imported", currentTotalUnits),
                "imported"
            );
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
            emitProgress(
                terminalActionListProgress("failed", currentTotalUnits),
                "failed"
            );
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
        const finalCompleted = Math.max(completed, lastEmittedCompleted);
        const finalSessionUnits = Math.max(
            completedSessionUnits,
            lastEmittedSessionUnits
        );
        selection.onProgress({
            completed: finalCompleted,
            total: ordered.length,
            weightCompleted: finalSessionUnits,
            weightTotal: totalSessionUnits,
            weightCurrent: 0,
            currentKey: "",
            currentType: null,
            currentIdentity: "done",
            orderIndex: -1,
            rowStatus: null,
            currentLabel: "done",
            phase: "done",
            phaseLabel: "done",
            unitCompleted: 1,
            unitTotal: 1,
            estimatedCompleted: finalSessionUnits,
            estimatedTotal: totalSessionUnits,
            etaConfidence: "planned",
            phaseBudget: null,
            weights,
            failed: result.failed,
        });
    }

    try {
        savePhaseStatsToDisk();
    } catch (error) {
        ctx.displayMessage(`&e[htsw] Failed to save import timing stats: ${error}`);
    }

    return result;
}

/**
 * Cache-aware work estimate for an importable. Used to weight the
 * progress bar so a function with 50 actions advances it much more than
 * a function with 2 actions. Looks up the housing's last-known observed
 * state if one exists and uses it to predict reading / hydrating /
 * applying work; falls back silently to the "assume empty housing"
 * worst-case when no cache exists for the importable. `Math.max(1, …)`
 * guards against zero-cost importables breaking ratio math.
 */
function estimateImportableWeightWithCache(
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
