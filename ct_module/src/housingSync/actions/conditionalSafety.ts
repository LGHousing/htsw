import { Diagnostic } from "htsw";
import type { ActionConditional } from "htsw/types";
import type { Observed } from "../observedActions";
import type { ActionListDiff, ConditionListOperation } from "./diff/types";

// Removed only after the body verifies. Never trust cached child lists for a
// surviving partial build, even if the shallow counts happen to match.
export const CONDITIONAL_BUILD_NOTE = "[HTSW building conditional]";

export function assertConditionalGuardEditSafe(
    current: Observed<ActionConditional> | undefined,
    desired: ActionConditional,
    operations: readonly ConditionListOperation[] | null
): void {
    // Messages are effects too (including repeated chat); unknown bodies are
    // not empty. Notes do not change the predicate.
    if (conditionalGuardEditNeedsReplacement(current, desired, operations)) {
        throw Diagnostic.error(
            "Cannot change the guards of a conditional with existing or unread actions while it can execute. The live guards were preserved."
        );
    }
}

function conditionalGuardEditNeedsReplacement(
    current: Observed<ActionConditional> | undefined,
    desired: ActionConditional,
    operations: readonly ConditionListOperation[] | null
): boolean {
    return !!(
        current &&
        (current.ifActions?.length !== 0 || current.elseActions?.length !== 0) &&
        conditionalPredicateChanges(current, desired, operations)
    );
}

export function conditionalPredicateChanges(
    current: Observed<ActionConditional>,
    desired: ActionConditional,
    operations: readonly ConditionListOperation[] | null
): boolean {
    return (
        current.matchAny !== desired.matchAny ||
        operations === null ||
        operations.some((op) => op.kind !== "edit" || !op.noteOnly)
    );
}

export function preflightConditionalEdits(diff: ActionListDiff): void {
    for (const op of diff.operations) {
        if (
            op.kind !== "edit" ||
            op.desired.type !== "CONDITIONAL" ||
            op.baselineAction.type !== "CONDITIONAL"
        )
            continue;
        if (op.replaceConditional) continue;
        const conditions = op.childListDiffs.find((list) => list.kind === "conditions");
        assertConditionalGuardEditSafe(
            op.baselineAction,
            op.desired,
            conditions?.kind === "conditions" ? conditions.diff.operations : []
        );
    }
}
