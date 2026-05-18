import { Diagnostic } from "../../diagnostic";
import {
    ActionBehaviors,
    type ActionBehavior,
} from "../behaviors/actions";
import { parseValue, type Var } from "../vars";
import { behaviorEntries, holderFor } from "./helpers";
import type { Vars } from "./vars";

export class SimpleActionBehaviors extends ActionBehaviors {
    constructor(vars: Vars) {
        super();
        for (const [type, handler] of behaviorEntries<ActionBehavior>(
            ActionBehaviors.default(),
        )) {
            this.with(type, handler);
        }
        this.with("CHANGE_VAR", makeChangeVar(vars));
    }
}

function makeChangeVar(vars: Vars): ActionBehavior<"CHANGE_VAR"> {
    return (rt, action) => {
        if (!action.holder || !action.op || !action.key) return;

        const holder = holderFor(vars, action.holder);
        const key = action.key;

        if (action.op === "Unset") {
            holder.unset(key);
            return;
        }

        if (!action.value) return;

        const rhs: Var<any> = parseValue(rt, action.value);
        const lhs = holder.get(key, rhs.unsetValue());

        if (action.op === "Set") {
            holder.set(key, rhs);
            return;
        }

        if (lhs.type !== rhs.type || lhs.type === "string" || rhs.type === "string") {
            rt.emitDiagnostic(
                Diagnostic.warning(
                    `Operator ${action.op} cannot be applied to ${lhs.type} and ${rhs.type}`,
                ).addPrimarySpan(rt.spans.getField(action, "op")),
            );
            return;
        }

        holder.set(key, lhs.binOp(rhs, action.op));
    };
}
