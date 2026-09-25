import { openAnswerableConflictPrompt } from "../gui/popovers/conflictPrompt";
import type TaskContext from "../tasks/context";
import { prunePlanPopoverLines, summarizeTargets } from "./report";
import type { PrunePlan, PruneTarget } from "./types";

/**
 * The prompt shown before anything is removed. `firstTime` takes consent for a
 * project that has never pruned this house here, so its wording names what the
 * file is claiming rather than only what is about to go.
 */
export async function confirmPrune(
    ctx: TaskContext,
    targets: readonly PruneTarget[],
    plan: PrunePlan,
    manifestPath: string,
    firstTime: boolean
): Promise<boolean> {
    const summary = summarizeTargets(targets);
    const heading = firstTime
        ? `[htsw] ${manifestPath} claims this whole house. Removing ${summary}.`
        : `[htsw] Prune will remove ${summary}.`;
    return openAnswerableConflictPrompt(ctx, {
        chatMessage: `${heading}\n[htsw] Housing has no undo.`,
        chatConfirmAction: "remove them",
        chatRefuseAction: "leave the house alone",
        title: firstTime
            ? "Let this file delete everything else in this house?"
            : "Remove undeclared house content?",
        lines: prunePlanPopoverLines(targets, plan),
        confirmLabel: `Remove ${targets.length}`,
        cancelLabel: "Leave alone",
        danger: true,
    });
}
