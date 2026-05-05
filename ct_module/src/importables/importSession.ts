import { Diagnostic, SourceMap, parseImportablesResult } from "htsw";
import type { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import { FileSystemFileLoader } from "../utils/files";
import { buildKnowledgeTrustPlan, importableIdentity, trustPlanKey } from "../knowledge";
import { printDiagnostic } from "../tui/diagnostics";
import { createItemRegistry } from "./itemRegistry";
import { importImportable } from "./imports";
import { setActiveDiffSink, type ImportDiffSink } from "../importer/diffSink";

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
    currentLabel: string;
    failed: number;
};

export type ImportSessionResult = {
    imported: number;
    skippedTrusted: number;
    failed: number;
};

export async function importSelectedImportables(
    ctx: TaskContext,
    selection: ImportSelection
): Promise<ImportSessionResult> {
    const sm = new SourceMap(new FileSystemFileLoader());
    const parsed = parseImportablesResult(sm, selection.sourcePath);
    const registry = createItemRegistry(parsed.value, parsed.gcx);
    const selectedKeys = new Set(
        selection.importables.map((importable) =>
            trustPlanKey(importable.type, importableIdentity(importable))
        )
    );
    const ordered = [
        ...parsed.value.filter((i) => i.type === "ITEM"),
        ...parsed.value.filter((i) => i.type !== "ITEM"),
    ].filter((importable) =>
        selectedKeys.has(trustPlanKey(importable.type, importableIdentity(importable)))
    );
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
        const plan = trustPlan?.importables.get(key);
        const label = `${importable.type} ${importableIdentity(importable)}`;
        if (selection.onProgress) {
            selection.onProgress({
                completed,
                total: ordered.length,
                weightCompleted,
                weightTotal,
                weightCurrent,
                currentLabel: label,
                failed: result.failed,
            });
        }

        if (plan?.wholeImportableTrusted) {
            result.skippedTrusted++;
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
            });
            if (!plan?.wholeImportableTrusted) {
                result.imported++;
            }
        } catch (error) {
            result.failed++;
            if (error instanceof Diagnostic) {
                printDiagnostic(sm, error);
            } else {
                ctx.displayMessage(`&cFailed to import ${importable.type}: ${error}`);
            }
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
            currentLabel: "done",
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
    if (importable.type === "FUNCTION") {
        return 2 + countActionWeight(importable.actions);
    }
    if (importable.type === "EVENT") {
        return 1 + countActionWeight(importable.actions);
    }
    if (importable.type === "REGION") {
        return (
            3 +
            countActionWeight(importable.onEnterActions ?? []) +
            countActionWeight(importable.onExitActions ?? [])
        );
    }
    if (importable.type === "ITEM") {
        return (
            3 +
            countActionWeight(importable.leftClickActions ?? []) +
            countActionWeight(importable.rightClickActions ?? [])
        );
    }
    if (importable.type === "NPC") {
        return (
            5 +
            countActionWeight(importable.leftClickActions ?? []) +
            countActionWeight(importable.rightClickActions ?? [])
        );
    }
    if (importable.type === "MENU") {
        return 2 + (importable.slots?.length ?? 0) * 4;
    }
    return 1;
}

function countActionWeight(actions: readonly any[]): number {
    let total = 0;
    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        // Each action is at least one Housing GUI list-add, plus its field
        // edits. Nested CONDITIONAL/RANDOM bodies recurse so their nested
        // actions count too.
        total += 2;
        if (action && typeof action === "object") {
            if (Array.isArray(action.ifActions)) {
                total += countActionWeight(action.ifActions);
            }
            if (Array.isArray(action.elseActions)) {
                total += countActionWeight(action.elseActions);
            }
            if (Array.isArray(action.conditions)) {
                total += action.conditions.length;
            }
            if (Array.isArray(action.actions)) {
                total += countActionWeight(action.actions);
            }
        }
    }
    return total;
}
