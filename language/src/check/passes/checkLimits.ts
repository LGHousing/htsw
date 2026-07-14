import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import { visitActionTrees, type ActionTreeContext } from "../actionTree";
import {
    ACTION_NAMES,
    CONDITION_NAMES,
    getActionLimit,
    getConditionLimit,
    type Action,
    type Condition,
    type Importable,
} from "../../types";

export function checkLimits(gcx: GlobalCtxt, importables: Importable[] = gcx.importables) {
    visitActionTrees(importables, {
        actionList: (actions, context) => checkActionCounts(gcx, actions, context),
        conditions: conditions => checkConditionList(gcx, conditions, "Conditional"),
    });
}

function checkActionCounts(
    gcx: GlobalCtxt,
    actions: readonly Action[],
    context: ActionTreeContext,
) {
    const counts = new Map<Action["type"], Action[]>();

    for (const action of actions) {
        const existing = counts.get(action.type);
        if (existing) {
            existing.push(action);
        } else {
            counts.set(action.type, [action]);
        }
    }

    for (const [type, matchingActions] of counts) {
        const limit = getActionLimit(type, context);
        if (limit === undefined || matchingActions.length <= limit) {
            continue;
        }

        const firstExtra = matchingActions[limit];
        gcx.addDiagnostic(
            Diagnostic.error(
                `Maximum amount of ${ACTION_NAMES[type]} actions exceeded in ${context.label}: ${matchingActions.length}/${limit}.`
            ).addPrimarySpan(gcx.spans.getField(firstExtra, "type"))
        );
    }
}

function checkConditionList(
    gcx: GlobalCtxt,
    conditions: readonly Condition[],
    label: string,
) {
    const counts = new Map<Condition["type"], Condition[]>();

    for (const condition of conditions) {
        const existing = counts.get(condition.type);
        if (existing) {
            existing.push(condition);
        } else {
            counts.set(condition.type, [condition]);
        }
    }

    for (const [type, matchingConditions] of counts) {
        const limit = getConditionLimit(type);
        if (limit === undefined || matchingConditions.length <= limit) {
            continue;
        }

        const firstExtra = matchingConditions[limit];
        gcx.addDiagnostic(
            Diagnostic.error(
                `Maximum amount of ${CONDITION_NAMES[type]} conditions exceeded in ${label}: ${matchingConditions.length}/${limit}.`
            ).addPrimarySpan(gcx.spans.getField(firstExtra, "type"))
        );
    }
}
