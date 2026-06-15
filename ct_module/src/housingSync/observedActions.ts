import type { Action } from "htsw/types";
import type { Observed, ObservedActionSlot } from "./types";

export function observedSlotsToActions(slots: readonly ObservedActionSlot[]): Action[] {
    const result: Action[] = [];
    for (const slot of slots) {
        if (slot.action === null) continue;
        result.push(observedActionToAction(slot.action));
    }
    return result;
}

function observedActionToAction(observed: Observed<Action>): Action {
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
    return observed;
}
