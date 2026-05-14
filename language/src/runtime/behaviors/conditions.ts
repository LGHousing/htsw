import type { Condition } from "../../types";
import { Behaviors, type Behavior } from "./behaviors";
import { parseValue, type Var } from "../vars";

export type ConditionBehavior<T extends Condition["type"] = Condition["type"]> = Behavior<
    Extract<Condition, { type: T }>,
    boolean
>;

export class ConditionBehaviors extends Behaviors<Condition, boolean> {
    static default(): ConditionBehaviors {
        return new ConditionBehaviors()
            .with("COMPARE_PLACEHOLDER", defaultBehaviorComparePlaceholder);
    }
}

const defaultBehaviorComparePlaceholder: ConditionBehavior<"COMPARE_PLACEHOLDER"> = (
    rt,
    condition,
) => {
    if (!condition.placeholder || !condition.op || !condition.amount) return false;

    const lhs = rt.runPlaceholder(condition.placeholder);
    if (!lhs) return false;
    const rhs: Var<any> = parseValue(rt, condition.amount);

    return lhs.cmpOp(rhs, condition.op);
};
