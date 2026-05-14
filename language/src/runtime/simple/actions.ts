import { Diagnostic } from "../../diagnostic";
import {
    ActionBehaviors,
    type ActionBehavior,
} from "../behaviors/actions";
import { parseValue, type Var } from "../vars";
import type { VarHolder } from "./varHolder";
import type { Vars } from "./vars";

// Opinionated default ActionBehaviors that knows how to read/write player /
// global / team vars via the supplied `vars` storage. Extends the barebones
// ActionBehaviors.default() so any user-defined .with(...) chains continue
// to work on top.
export class SimpleActionBehaviors extends ActionBehaviors {
    constructor(vars: Vars) {
        super();
        const defaults = ActionBehaviors.default();
        // Copy barebones defaults (EXIT, PAUSE, RANDOM, CONDITIONAL).
        for (const [type, handler] of entriesOf(defaults)) {
            this.with(type, handler);
        }
        this.with("CHANGE_VAR", makeChangeVar(vars));
    }
}

// Internal: pull the registered handler map off a Behaviors instance. We
// don't want to add a public accessor to the base class just for this.
function entriesOf(
    behaviors: ActionBehaviors,
): Array<[any, ActionBehavior]> {
    const handlers = (behaviors as unknown as {
        handlers: Record<string, ActionBehavior>;
    }).handlers;
    return Object.entries(handlers) as Array<[any, ActionBehavior]>;
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

function holderFor(
    vars: Vars,
    holder: { type: "Player" } | { type: "Global" } | { type: "Team"; team?: string },
): VarHolder<string> {
    if (holder.type === "Team") return vars.team(holder.team ?? "");
    if (holder.type === "Global") return vars.global;
    return vars.player;
}
