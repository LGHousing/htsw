import type { GlobalCtxt } from "../../context";
import { Diagnostic } from "../../diagnostic";
import type { Action } from "../../types";
import { getActions } from "../helpers";

export function checkNestedConditionals(gcx: GlobalCtxt) {
    for (const action of getActions(gcx)) {
        checkAction(gcx, action);
    }
}

function checkAction(gcx: GlobalCtxt, action: Action) {
    if (action.type === "CONDITIONAL") {

        const subActions = action.ifActions.concat(action.elseActions);

        // Check for nested conditionals.
        for (const subAction of subActions) {
            if (subAction.type === "CONDITIONAL") {
                gcx.addDiagnostic(
                    Diagnostic.error("Nested Conditional actions are not allowed")
                        .addPrimarySpan(gcx.spans.getField(subAction, "type"))
                );
            }
            if (subAction.type === "RANDOM") {
                gcx.addDiagnostic(
                    Diagnostic.error("Random actions are not allowed inside Conditional actions")
                        .addPrimarySpan(gcx.spans.getField(subAction, "type"))
                );
            }
        }

    }

    else if (action.type === "RANDOM") {
        const subActions = action.actions;

        // Check for nested conditionals.
        for (const subAction of subActions) {
            if (subAction.type === "CONDITIONAL") {
                gcx.addDiagnostic(
                    Diagnostic.error("Nested Random actions are not allowed")
                        .addPrimarySpan(gcx.spans.getField(subAction, "type"))
                );
            }
            if (subAction.type === "RANDOM") {
                gcx.addDiagnostic(
                    Diagnostic.error("Conditional actions are not allowed inside Random actions")
                        .addPrimarySpan(gcx.spans.getField(subAction, "type"))
                );
            }
        }
    }
}