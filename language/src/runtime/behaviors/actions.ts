import { Diagnostic } from "../../diagnostic";
import type { Action } from "../../types";
import { Behaviors, type Behavior } from "./behaviors";
import type { Runtime } from "../runtime";
import { parseValue, type TeamVarKey, type Var, type VarHolder } from "../vars";

export class RuntimeExitSignal { }

export class RuntimePauseSignal {
    readonly ticks: number;
    readonly continuation: Action[];

    constructor(ticks: number, continuation: Action[] = []) {
        this.ticks = ticks;
        this.continuation = continuation;
    }
}

export type ActionBehavior<T extends Action["type"] = Action["type"]> = Behavior<
    Extract<Action, { type: T }>,
    void
>;

export class ActionBehaviors extends Behaviors<Action, void> {
    static default(): ActionBehaviors {
        return new ActionBehaviors()
            .with("EXIT", defaultBehaviorExit)
            .with("PAUSE", defaultBehaviorPause)
            .with("CHANGE_VAR", defaultBehaviorChangeVar)
            .with("RANDOM", defaultBehaviorRandom)
            .with("CONDITIONAL", defaultBehaviorConditional)
    }
}

const defaultBehaviorExit: ActionBehavior<"EXIT"> = () => {
    throw new RuntimeExitSignal();
};

const defaultBehaviorPause: ActionBehavior<"PAUSE"> = (_rt, action) => {
    throw new RuntimePauseSignal(Math.max(0, Math.floor(action.ticks ?? 0)));
};

const defaultBehaviorChangeVar: ActionBehavior<"CHANGE_VAR"> = (rt, action) => {
    if (!action.holder || !action.op || !action.key) return;

    const holderType = action.holder.type;
    const key: string | TeamVarKey = holderType === "team"
        ? { team: action.holder.team ?? "", key: action.key }
        : action.key;
    const varHolder: VarHolder<any> = holderType === "team"
        ? rt.teamVars
        : holderType === "global"
            ? rt.globalVars
            : rt.playerVars;

    if (action.op === "Unset") {
        varHolder.unsetVar(key);
        return;
    }

    if (!action.value) return;

    const rhs: Var<any> = parseValue(rt, action.value);
    const lhs = varHolder.getVar(key, rhs.unsetValue());

    if (action.op === "Set") {
        varHolder.setVar(key, rhs);
        return;
    }

    if (lhs.type !== rhs.type || lhs.type === "string" || rhs.type === "string") {
        rt.emitDiagnostic(
            Diagnostic.warning(
                `Operator ${action.op} cannot be applied to ${lhs.type} and ${rhs.type}`,
            ).addPrimarySpan(rt.spans.getField(action, "op"))
        );
        return;
    }

    varHolder.setVar(key, lhs.binOp(rhs, action.op));
};

const defaultBehaviorRandom: ActionBehavior<"RANDOM"> = (rt, action) => {
    if (!action.actions || action.actions.length === 0) return;
    const randomIndex = Math.floor(Math.random() * action.actions.length);
    rt.runActions([action.actions[randomIndex]], true);
};

const defaultBehaviorConditional: ActionBehavior<"CONDITIONAL"> = (rt, action) => {
    if (!action.conditions || action.matchAny === undefined || !action.ifActions) return;

    let matches = 0;
    for (const condition of action.conditions) {
        if (rt.runCondition(condition)) matches++;
    }

    const passed = action.matchAny
        ? matches > 0
        : matches === action.conditions.length;

    if (passed) {
        rt.runActions(action.ifActions, true);
    } else if (action.elseActions) {
        rt.runActions(action.elseActions, true);
    }
};
