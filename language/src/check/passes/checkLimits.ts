import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import {
    ACTION_NAMES,
    CONDITION_NAMES,
    getActionLimit,
    getConditionLimit,
    type Action,
    type ActionLimitContext,
    type Condition,
} from "../../types";

type ActionListContext = ActionLimitContext & {
    label: string;
};

export function checkLimits(gcx: GlobalCtxt) {
    for (const importable of gcx.importables) {
        if (importable.type === "FUNCTION") {
            checkActionList(gcx, importable.actions, {
                importable: "functions",
                label: `Function "${importable.name}"`,
            });
        } else if (importable.type === "EVENT") {
            checkActionList(gcx, importable.actions, {
                importable: "events",
                eventName: importable.event,
                label: `${importable.event} event`,
            });
        } else if (importable.type === "ITEM") {
            checkActionList(gcx, importable.leftClickActions ?? [], {
                importable: "items",
                label: `Item "${importable.name}" left-click actions`,
            });
            checkActionList(gcx, importable.rightClickActions ?? [], {
                importable: "items",
                label: `Item "${importable.name}" right-click actions`,
            });
        } else if (importable.type === "MENU") {
            for (const slot of importable.slots) {
                checkActionList(gcx, slot.actions ?? [], {
                    importable: "menus",
                    label: `Menu "${importable.name}" slot ${slot.slot}`,
                });
            }
        } else if (importable.type === "REGION") {
            checkActionList(gcx, importable.onEnterActions ?? [], {
                importable: "regions",
                label: `Region "${importable.name}" enter actions`,
            });
            checkActionList(gcx, importable.onExitActions ?? [], {
                importable: "regions",
                label: `Region "${importable.name}" exit actions`,
            });
        } else if (importable.type === "NPC") {
            checkActionList(gcx, importable.leftClickActions ?? [], {
                importable: "npcs",
                label: `NPC "${importable.name}" left-click actions`,
            });
            checkActionList(gcx, importable.rightClickActions ?? [], {
                importable: "npcs",
                label: `NPC "${importable.name}" right-click actions`,
            });
        }
    }
}

function checkActionList(
    gcx: GlobalCtxt,
    actions: Action[],
    context: ActionListContext,
) {
    checkActionCounts(gcx, actions, context);

    for (const action of actions) {
        if (action.type === "CONDITIONAL") {
            checkConditionList(gcx, action.conditions, "Conditional");
            checkActionList(gcx, action.ifActions, {
                ...context,
                nested: "conditional",
                label: `${context.label} Conditional if-actions`,
            });
            checkActionList(gcx, action.elseActions, {
                ...context,
                nested: "conditional",
                label: `${context.label} Conditional else-actions`,
            });
        } else if (action.type === "RANDOM") {
            checkActionList(gcx, action.actions, {
                ...context,
                nested: "random",
                label: `${context.label} Random actions`,
            });
        }
    }
}

function checkActionCounts(
    gcx: GlobalCtxt,
    actions: Action[],
    context: ActionListContext,
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
    conditions: Condition[],
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
