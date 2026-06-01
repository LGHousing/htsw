import {
    ConditionBehaviors,
    type ConditionBehavior,
} from "../behaviors/conditions";
import { parseValue, type Var } from "../vars";
import { behaviorEntries, holderFor } from "./helpers";
import type { Vars } from "./vars";

export class SimpleConditionBehaviors extends ConditionBehaviors {
    constructor(vars: Vars) {
        super();
        for (const [type, handler] of behaviorEntries<ConditionBehavior>(
            ConditionBehaviors.default(),
        )) {
            this.with(type, handler);
        }
        this.with("COMPARE_VAR", makeCompareVar(vars));
    }
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
