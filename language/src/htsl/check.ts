import type { GlobalCtxt } from "../context";
import { Diagnostic } from "../diagnostic";
import type { Action } from "../types";
import { check as checkTypes } from "./typecheck/check";
import { TyCtxt } from "./typecheck/context";

export function check(gcx: GlobalCtxt, actions: Action[]) {
    for (const action of actions) {
        checkAction(gcx, action);
    }

    const tcx = TyCtxt.fromGlobalCtxt(gcx);
    checkTypes(tcx, actions);
}

function checkAction(gcx: GlobalCtxt, action: Action) {
    if (action.type === "CONDITIONAL") {

        const subActions = action.ifActions.concat(action.elseActions ?? []);

        // Check for nested conditionals.
        for (const subAction of subActions) {
            if (subAction.type === "CONDITIONAL") {
                gcx.addDiagnostic(
                    Diagnostic.error("Nested conditionals are not allowed")
                        .addPrimarySpan(gcx.spans.getField(subAction, "type"))
                );
            }
            if (subAction.type === "RANDOM") {
                gcx.addDiagnostic(
                    Diagnostic.error("Random actions are not allowed inside conditionals")
                        .addPrimarySpan(gcx.spans.getField(subAction, "type"))
                );
            }
        }

    }
}