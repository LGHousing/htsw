import type { Action, ActionLimitContext, Condition, Event, Importable } from "../types";

export type ActionTreeContext = ActionLimitContext & {
    label: string;
    event?: Event;
};

type ActionTreeVisitor = {
    actionList?: (actions: readonly Action[], context: ActionTreeContext) => void;
    action?: (action: Action, context: ActionTreeContext) => void;
    conditions?: (
        conditions: readonly Condition[],
        action: Extract<Action, { type: "CONDITIONAL" }>,
        context: ActionTreeContext,
    ) => void;
};

export function visitActionTrees(
    importables: readonly Importable[],
    visitor: ActionTreeVisitor,
) {
    for (const importable of importables) {
        switch (importable.type) {
            case "FUNCTION":
                visitActionList(importable.actions ?? [], {
                    importable: "functions",
                    label: `Function "${importable.name}"`,
                }, visitor);
                break;
            case "EVENT":
                visitActionList(importable.actions, {
                    importable: "events",
                    event: importable.event,
                    label: `${importable.event} event`,
                }, visitor);
                break;
            case "ITEM":
                visitActionList(importable.leftClickActions ?? [], {
                    importable: "items",
                    label: `Item "${importable.name}" left-click actions`,
                }, visitor);
                visitActionList(importable.rightClickActions ?? [], {
                    importable: "items",
                    label: `Item "${importable.name}" right-click actions`,
                }, visitor);
                break;
            case "MENU":
                for (const slot of importable.slots) {
                    visitActionList(slot.actions ?? [], {
                        importable: "menus",
                        label: `Menu "${importable.name}" slot ${slot.slot}`,
                    }, visitor);
                }
                break;
            case "REGION":
                visitActionList(importable.onEnterActions ?? [], {
                    importable: "regions",
                    label: `Region "${importable.name}" enter actions`,
                }, visitor);
                visitActionList(importable.onExitActions ?? [], {
                    importable: "regions",
                    label: `Region "${importable.name}" exit actions`,
                }, visitor);
                break;
            case "COMMAND":
                visitActionList(importable.actions ?? [], {
                    importable: "commands",
                    label: `Command "${importable.name}"`,
                }, visitor);
                break;
            case "NPC":
                visitActionList(importable.leftClickActions ?? [], {
                    importable: "npcs",
                    label: `NPC "${importable.name}" left-click actions`,
                }, visitor);
                visitActionList(importable.rightClickActions ?? [], {
                    importable: "npcs",
                    label: `NPC "${importable.name}" right-click actions`,
                }, visitor);
                break;
            case "TEAM":
            case "GROUP":
                break;
            default: {
                const exhaustive: never = importable;
                return exhaustive;
            }
        }
    }
}

function visitActionList(
    actions: readonly Action[],
    context: ActionTreeContext,
    visitor: ActionTreeVisitor,
) {
    visitor.actionList?.(actions, context);

    for (const action of actions) {
        visitor.action?.(action, context);

        if (action.type === "CONDITIONAL") {
            visitor.conditions?.(action.conditions, action, context);
            visitActionList(action.ifActions, {
                ...context,
                nested: "conditional",
                label: `${context.label} Conditional if-actions`,
            }, visitor);
            visitActionList(action.elseActions, {
                ...context,
                nested: "conditional",
                label: `${context.label} Conditional else-actions`,
            }, visitor);
        } else if (action.type === "RANDOM") {
            visitActionList(action.actions, {
                ...context,
                nested: "random",
                label: `${context.label} Random actions`,
            }, visitor);
        }
    }
}
