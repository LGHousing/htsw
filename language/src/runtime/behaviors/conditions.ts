import { Diagnostic } from "../../diagnostic";
import type { Condition } from "../../types";
import { Behaviors, type Behavior } from "./behaviors";
import { parseValue, type TeamVarKey, type Var, type VarHolder } from "../vars";

export type ConditionBehavior<T extends Condition["type"] = Condition["type"]> = Behavior<
    Extract<Condition, { type: T }>,
    boolean
>;

export class ConditionBehaviors extends Behaviors<Condition, boolean> {
    static default(): ConditionBehaviors {
        return new ConditionBehaviors()
            .with("COMPARE_VAR", defaultBehaviorCompareVar)
            .with("COMPARE_PLACEHOLDER", defaultBehaviorComparePlaceholder);
    }
}

const defaultBehaviorCompareVar: ConditionBehavior<"COMPARE_VAR"> = (rt, condition) => {
    if (!condition.holder || !condition.var || !condition.op || !condition.amount) {
        return false;
    }

    const holderType = condition.holder.type;
    const key: string | TeamVarKey = holderType === "team"
        ? { team: condition.holder.team ?? "", key: condition.var }
        : condition.var;

    const varHolder: VarHolder<any> = holderType === "team"
        ? rt.teamVars
        : holderType === "global"
            ? rt.globalVars
            : rt.playerVars;

    let fallback: Var<any> | undefined;
    if (condition.fallback) {
        fallback = parseValue(rt, condition.fallback);
    }

    const rhs: Var<any> = parseValue(rt, condition.amount);
    const lhs = varHolder.getVar(key, fallback);

    return lhs.cmpOp(rhs, condition.op);
};

const defaultBehaviorComparePlaceholder: ConditionBehavior<"COMPARE_PLACEHOLDER"> = (
    rt,
    condition,
) => {
    if (!condition.placeholder || !condition.op || !condition.amount) return false;

    const lhs = rt.runPlaceholder(condition.placeholder);
    if (!lhs) return false;

    let rhs: Var<any>;
    try {
        rhs = parseValue(rt, condition.amount);
    } catch (error) {
        rt.addDiagnostic(
            Diagnostic.warning((error as Error).message),
            condition,
            "amount",
        );
        return false;
    }

    return lhs.cmpOp(rhs, condition.op);
};
