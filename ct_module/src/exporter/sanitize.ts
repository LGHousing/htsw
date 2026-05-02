import type { Action } from "htsw/types";
import type { Observed, ObservedActionSlot } from "../importer/types";

/**
 * Convert an `ObservedActionSlot[]` (the importer's read shape, which carries
 * GUI metadata and may have null entries for unrecognized actions) into a
 * clean `Action[]` suitable for emission.
 *
 * Drops:
 *   - top-level slots whose action couldn't be parsed (`entry.action === null`),
 *   - nested action-list entries that are null (same reason).
 */
export function observedSlotsToActions(
    slots: readonly ObservedActionSlot[]
): Action[] {
    const result: Action[] = [];
    for (const slot of slots) {
        if (slot.action === null) continue;
        result.push(observedActionToAction(slot.action));
    }
    return result;
}

/**
 * Walk an `Observed<Action>` and produce a canonical `Action`. The two
 * shapes differ only in nested array element types (`Action[]` vs.
 * `Array<Observed<Action> | null>` and `Condition[]` vs.
 * `Array<Condition | null>`), so the work is mostly stripping nulls.
 */
function observedActionToAction(observed: Observed<Action>): Action {
    // Recurse into known nested-list-bearing types.
    if (observed.type === "CONDITIONAL") {
        return {
            type: "CONDITIONAL",
            matchAny: observed.matchAny,
            conditions: (observed.conditions ?? []).filter(
                (c): c is NonNullable<typeof c> => c !== null
            ),
            ifActions: (observed.ifActions ?? [])
                .filter((a): a is Observed<Action> => a !== null)
                .map(observedActionToAction),
            elseActions: (observed.elseActions ?? [])
                .filter((a): a is Observed<Action> => a !== null)
                .map(observedActionToAction),
            ...(observed.note !== undefined ? { note: observed.note } : {}),
        };
    }
    if (observed.type === "RANDOM") {
        return {
            type: "RANDOM",
            actions: (observed.actions ?? [])
                .filter((a): a is Observed<Action> => a !== null)
                .map(observedActionToAction),
            ...(observed.note !== undefined ? { note: observed.note } : {}),
        };
    }
    // No nested lists — `Observed<T>` is structurally identical to T for
    // these. The cast is safe because we've handled every type with
    // nested lists above.
    return observed;
}
