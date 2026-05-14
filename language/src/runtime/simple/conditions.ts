import {
    ConditionBehaviors,
    type ConditionBehavior,
} from "../behaviors/conditions";
import { parseValue, type Var } from "../vars";
import type { VarHolder } from "./varHolder";
import type { Vars } from "./vars";

// Opinionated default ConditionBehaviors that knows how to read player /
// global / team vars for COMPARE_VAR comparisons via the supplied storage.
// Extends ConditionBehaviors.default() so COMPARE_PLACEHOLDER and any
// user-defined .with(...) chains continue to work.
export class SimpleConditionBehaviors extends ConditionBehaviors {
    constructor(vars: Vars) {
        super();
        const defaults = ConditionBehaviors.default();
        for (const [type, handler] of entriesOf(defaults)) {
            this.with(type, handler);
        }
        this.with("COMPARE_VAR", makeCompareVar(vars));
    }
}

function entriesOf(
    behaviors: ConditionBehaviors,
): Array<[any, ConditionBehavior]> {
    const handlers = (behaviors as unknown as {
        handlers: Record<string, ConditionBehavior>;
    }).handlers;
    return Object.entries(handlers) as Array<[any, ConditionBehavior]>;
}

function makeCompareVar(vars: Vars): ConditionBehavior<"COMPARE_VAR"> {
    return (rt, condition) => {
        if (!condition.holder || !condition.var || !condition.op || !condition.amount) {
            return false;
        }

        const holder = holderFor(vars, condition.holder);
        const key = condition.var;

        let fallback: Var<any> | undefined;
        if (condition.fallback) {
            fallback = parseValue(rt, condition.fallback);
        }

        const rhs: Var<any> = parseValue(rt, condition.amount);
        const lhs = holder.get(key, fallback);

        return lhs.cmpOp(rhs, condition.op);
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
