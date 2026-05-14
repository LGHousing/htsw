import type { Action } from "../../types";
import { Behaviors, type Behavior } from "./behaviors";

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

const defaultBehaviorRandom: ActionBehavior<"RANDOM"> = (rt, action) => {
    if (!action.actions || action.actions.length === 0) return;
    const randomIndex = Math.floor(Math.random() * action.actions.length);
    rt.runActions([action.actions[randomIndex]], true);
};

const defaultBehaviorConditional: ActionBehavior<"CONDITIONAL"> = (rt, action) => {
    if (!action.conditions || action.matchAny === undefined || !action.ifActions) return;

    // We always run ifActions if there are no conditions.
    if (action.conditions.length === 0) {
        rt.runActions(action.ifActions, true);
        return;
    }

    let matches = 0;
    for (const condition of action.conditions) {
        if (rt.runCondition(condition)) matches++;
    }

    const passed = action.matchAny
        ? matches > 0
        : matches === action.conditions.length;

    if (passed) {
        rt.runActions(action.ifActions, true);
    } else {
        rt.runActions(action.elseActions, true);
    }
};
