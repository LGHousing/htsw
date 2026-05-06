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
import type { ActionListProgress, ActionListProgressPhase } from "../importer/types";
import { estimateImportableCost, type EtaConfidence } from "../importer/progress/costs";

// TODO: Make this work with GUI

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

export type ImportRunRowStatus =
    | "queued"
    | "current"
    | "imported"
    | "skipped"
    | "failed";

export type ImportProgress = {
    completed: number;
    total: number;
    /**
     * Cumulative "weight" of work completed (sum of estimated step counts of
     * importables that have finished). Better signal for the progress bar
     * than `completed/total` because importables vary wildly in size — a
     * function with 50 actions is much more work than one with 2.
     */
    weightCompleted: number;
    weightTotal: number;
    /**
     * Estimated weight of the importable currently being processed. The UI
     * can render an in-flight indicator between weightCompleted and
     * weightCompleted + weightCurrent for nicer mid-importable feedback.
     */
    weightCurrent: number;
    currentKey: string;
    currentType: Importable["type"] | null;
    currentIdentity: string;
    orderIndex: number;
    rowStatus: ImportRunRowStatus | null;
    currentLabel: string;
    phase:
        | "starting"
        | "opening"
        | "reading"
        | "hydrating"
        | "diffing"
        | "applying"
        | "writingKnowledge"
        | "done";
    phaseLabel: string;
    unitCompleted: number;
    unitTotal: number;
    estimatedCompleted: number;
    estimatedTotal: number;
    etaConfidence: EtaConfidence;
    failed: number;
};

export type ImportSessionResult = {
    imported: number;
    skippedTrusted: number;
    failed: number;
};

function importPhaseFromActionPhase(phase: ActionListProgressPhase): ImportProgress["phase"] {
    if (phase === "reading") return "reading";
    if (phase === "hydrating") return "hydrating";
    if (phase === "diffing") return "diffing";
    return "applying";
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
    const trustPlan = selection.trustMode
        ? buildKnowledgeTrustPlan(selection.housingUuid, parsed.value)
        : undefined;

    const result: ImportSessionResult = {
        imported: 0,
        skippedTrusted: 0,
        failed: 0,
    };

    const weights: number[] = ordered.map(estimateImportableWeight);
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
        const emitProgress = (
            phase: ImportProgress["phase"],
            phaseLabel: string,
            unitCompleted: number,
            unitTotal: number,
            estimatedCompleted?: number,
            estimatedTotal?: number,
            etaConfidence?: ImportProgress["etaConfidence"],
            rowStatus: ImportRunRowStatus = "current"
        ) => {
            if (!selection.onProgress) return;
            const remainingWeight = weightTotal - weightCompleted - weightCurrent;
            const refinedCurrentTotal = estimatedTotal ?? weightCurrent;
            const refinedCurrentCompleted =
                estimatedCompleted ??
                (unitTotal > 0
                    ? weightCurrent * Math.min(1, Math.max(0, unitCompleted / unitTotal))
                    : 0);
            selection.onProgress({
                completed,
                total: ordered.length,
                weightCompleted,
                weightTotal: weightCompleted + refinedCurrentTotal + remainingWeight,
                weightCurrent: refinedCurrentTotal,
                currentKey: key,
                currentType: importable.type,
                currentIdentity: identity,
                orderIndex: i,
                rowStatus,
                currentLabel: label,
                phase,
                phaseLabel,
                unitCompleted,
                unitTotal,
                estimatedCompleted: weightCompleted + refinedCurrentCompleted,
                estimatedTotal: weightCompleted + refinedCurrentTotal + remainingWeight,
                etaConfidence: etaConfidence ?? "rough",
                failed: result.failed,
            });
        };
        emitProgress("opening", "opening importable", 0, Math.max(1, weightCurrent));

        if (plan?.wholeImportableTrusted) {
            result.skippedTrusted++;
            emitProgress(
                "done",
                "trusted cache current; skipped",
                1,
                1,
                weightCurrent,
                weightCurrent,
                "planned",
                "skipped"
            );
            completed++;
            weightCompleted += weightCurrent;
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
                onActionListProgress: (progress: ActionListProgress) => {
                    emitProgress(
                        importPhaseFromActionPhase(progress.phase),
                        progress.label,
                        progress.completed,
                        progress.total,
                        progress.estimatedCompleted,
                        progress.estimatedTotal,
                        progress.confidence
                    );
                },
            });
            if (!plan?.wholeImportableTrusted) {
                result.imported++;
            }
            emitProgress(
                "done",
                "imported",
                1,
                1,
                weightCurrent,
                weightCurrent,
                "planned",
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
                "done",
                "failed",
                1,
                1,
                weightCurrent,
                weightCurrent,
                "planned",
                "failed"
            );
            if (error instanceof Diagnostic) {
                printDiagnostic(sm, error);
            } else {
                ctx.displayMessage(`&cFailed to import ${importable.type}: ${error}`);
                const e = error as {
                    stack?: string;
                    fileName?: string;
                    lineNumber?: number;
                };
                if (typeof e?.fileName === "string" && typeof e?.lineNumber === "number") {
                    ctx.displayMessage(`&7thrown at ${e.fileName}:${e.lineNumber}`);
                }
                if (typeof e?.stack === "string" && e.stack.length > 0) {
                    ctx.displayMessage(`&7${e.stack}`);
                }
            }
            // Halt the session on first failure rather than ploughing
            // through the remaining importables — they're often dependent
            // on each other and a partial import is worse than a clean
            // abort. The user can fix the failing importable and retry.
            ctx.displayMessage(
                `&c[htsw] Import aborted after failure on ${importable.type} ${importableIdentity(importable)}`
            );
            setActiveDiffSink(null);
            break;
        } finally {
            setActiveDiffSink(null);
        }
        completed++;
        weightCompleted += weightCurrent;
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
            failed: result.failed,
        });
    }

    return result;
}

/**
 * Rough work estimate for an importable. Used to weight the progress bar so
 * a function with 50 actions advances the bar much more than a function
 * with 2 actions. Numbers are heuristic — they don't need to be accurate,
 * just monotonic with how long the import will take.
 */
function estimateImportableWeight(importable: Importable): number {
    return Math.max(1, estimateImportableCost(importable));
}
