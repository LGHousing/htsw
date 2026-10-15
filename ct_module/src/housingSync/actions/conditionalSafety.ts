import { Diagnostic } from "htsw";
import type { ActionConditional } from "htsw/types";
import type { Observed } from "../observedActions";
import type { ActionListDiff, ConditionListOperation } from "./diff/types";

export function assertConditionalGuardEditSafe(
    current: Observed<ActionConditional> | undefined,
    desired: ActionConditional,
    operations: readonly ConditionListOperation[] | null
): void {
    // Messages are effects too (including repeated chat); unknown bodies are
    // not empty. Notes do not change the predicate.
    if (
        current &&
        (current.ifActions?.length !== 0 || current.elseActions?.length !== 0) &&
        (current.matchAny !== desired.matchAny ||
            operations === null ||
            operations.some((op) => op.kind !== "edit" || !op.noteOnly))
    ) {
        throw Diagnostic.error(
            "Cannot change the guards of a conditional with existing or unread actions while it can execute. The live guards were preserved."
        );
    }
}

export function preflightConditionalEdits(diff: ActionListDiff): void {
    for (const op of diff.operations) {
        if (
            op.kind !== "edit" ||
            op.desired.type !== "CONDITIONAL" ||
            op.baselineAction.type !== "CONDITIONAL"
        )
            continue;
        const conditions = op.childListDiffs.find((list) => list.kind === "conditions");
        assertConditionalGuardEditSafe(
            op.baselineAction,
            op.desired,
            conditions?.kind === "conditions" ? conditions.diff.operations : []
        );
    }
}
