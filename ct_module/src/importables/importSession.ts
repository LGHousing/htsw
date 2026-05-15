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
    let weightCompleted = 0;
    for (let i = 0; i < ordered.length; i++) {
        const importable = ordered[i];
        const weightCurrent = weights[i];
        const key = trustPlanKey(importable.type, importableIdentity(importable));
        const identity = importableIdentity(importable);
        const plan = trustPlan?.importables.get(key);
        const label = `${importable.type} ${identity}`;
        let refinedWeightCurrent = weightCurrent;
        let refinedCurrentCompleted = 0;
        /**
         * Merge an action-list-scope event (or a synthesized one for
         * importable-level transitions like "opening") with the
         * importable + session scope state that's closure-captured here,
         * then forward to the user's onProgress callback.
         */
        const emitProgress = (
            inner: ActionListProgressFields,
            rowStatus: ImportRunRowStatus = "current"
        ): void => {
            if (!selection.onProgress) return;
            const remainingWeight = weightTotal - weightCompleted - weightCurrent;
            const eventCurrentTotal = inner.estimatedTotal > 0
                ? inner.estimatedTotal
                : weightCurrent;
            if (eventCurrentTotal > refinedWeightCurrent) {
                refinedWeightCurrent = eventCurrentTotal;
            }
            let eventCurrentCompleted =
                rowStatus === "current"
                    ? (inner.estimatedCompleted > 0
                        ? inner.estimatedCompleted
                        : (inner.unitTotal > 0
                            ? refinedWeightCurrent *
                              Math.min(
                                  1,
                                  Math.max(0, inner.unitCompleted / inner.unitTotal)
                              )
                            : 0))
                    : refinedWeightCurrent;
            eventCurrentCompleted = Math.min(
                refinedWeightCurrent,
                Math.max(0, eventCurrentCompleted)
            );
            if (eventCurrentCompleted > refinedCurrentCompleted) {
                refinedCurrentCompleted = eventCurrentCompleted;
            }
            selection.onProgress({
                ...inner,
                completed,
                total: ordered.length,
                weightCompleted,
                weightTotal: weightCompleted + refinedWeightCurrent + remainingWeight,
                weightCurrent: refinedWeightCurrent,
                currentKey: key,
                currentType: importable.type,
                currentIdentity: identity,
                orderIndex: i,
                rowStatus,
                currentLabel: label,
                estimatedCompleted: weightCompleted + refinedCurrentCompleted,
                estimatedTotal: weightCompleted + refinedWeightCurrent + remainingWeight,
                weights,
                failed: result.failed,
            });
        };
        emitProgress({
            phase: "opening",
            phaseLabel: "opening importable",
            unitCompleted: 0,
            unitTotal: Math.max(1, weightCurrent),
            estimatedCompleted: 0,
            estimatedTotal: 0,
            etaConfidence: "rough",
            phaseBudget: null,
        });

        if (plan?.wholeImportableTrusted) {
            result.skippedTrusted++;
            emitProgress(
                {
                    phase: "done",
                    phaseLabel: "trusted cache current; skipped",
                    unitCompleted: 1,
                    unitTotal: 1,
                    estimatedCompleted: weightCurrent,
                    estimatedTotal: weightCurrent,
                    etaConfidence: "planned",
                    phaseBudget: null,
                },
                "skipped"
            );
            completed++;
            // Lock in the refined weight so the static `weightTotal`
            // stays consistent with `weights[]` and `weightCompleted` —
            // otherwise the next importable's `remainingWeight` calc
            // (weightTotal - weightCompleted - weightCurrent) can go
            // negative and the GUI's overall bar/ETA snaps backwards.
            weightTotal += refinedWeightCurrent - weightCurrent;
            weights[i] = refinedWeightCurrent;
            weightCompleted += refinedWeightCurrent;
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
                onActionListProgress: (progress) => {
                    emitProgress(progress);
                },
            });
            if (!plan?.wholeImportableTrusted) {
                result.imported++;
            }
            emitProgress(
                {
                    phase: "done",
                    phaseLabel: "imported",
                    unitCompleted: 1,
                    unitTotal: 1,
                    estimatedCompleted: weightCurrent,
                    estimatedTotal: weightCurrent,
                    etaConfidence: "planned",
                    phaseBudget: null,
                },
                "imported"
            );
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
                {
                    phase: "done",
                    phaseLabel: "failed",
                    unitCompleted: 1,
                    unitTotal: 1,
                    estimatedCompleted: weightCurrent,
                    estimatedTotal: weightCurrent,
                    etaConfidence: "planned",
                    phaseBudget: null,
                },
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
            weightTotal += refinedWeightCurrent - weightCurrent;
            weights[i] = refinedWeightCurrent;
            break;
        } finally {
            setActiveDiffSink(null);
        }
        completed++;
        weightTotal += refinedWeightCurrent - weightCurrent;
        weights[i] = refinedWeightCurrent;
        weightCompleted += refinedWeightCurrent;
    }

    if (selection.onProgress) {
        selection.onProgress({
            completed,
            total: ordered.length,
            weightCompleted,
            weightTotal,
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
            estimatedCompleted: weightCompleted,
            estimatedTotal: weightTotal,
            etaConfidence: "planned",
            phaseBudget: null,
            weights,
            failed: result.failed,
        });
    }

    // Persist the latest per-phase rate calibration so the next session
    // (or next game restart) starts already-warmed up instead of having
    // to re-learn the user's ping from the hard-coded defaults.
    savePhaseStatsToDisk();

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
