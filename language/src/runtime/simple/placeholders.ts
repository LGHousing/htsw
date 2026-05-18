import {
    PlaceholderBehaviors,
    type PlaceholderBehavior,
} from "../behaviors/placeholders";
import { parseValue, type Var } from "../vars";
import { behaviorEntries } from "./helpers";
import type { VarHolder } from "./varHolder";
import type { Vars } from "./vars";

export class SimplePlaceholderBehaviors extends PlaceholderBehaviors {
    constructor(vars: Vars) {
        super();
        for (const [type, handler] of behaviorEntries<PlaceholderBehavior>(
            PlaceholderBehaviors.default(),
        )) {
            this.with(type, handler);
        }
        this.with("var.player", makeVarPlayer(vars))
            .with("var.global", makeVarGlobal(vars))
            .with("var.team", makeVarTeam(vars));
    }
}

function makeVarPlayer(vars: Vars): PlaceholderBehavior {
    return (rt, invocation) =>
        resolveVar(vars.player, invocation.args[0] ?? "", invocation.args[1], rt);
}

function makeVarGlobal(vars: Vars): PlaceholderBehavior {
    return (rt, invocation) =>
        resolveVar(vars.global, invocation.args[0] ?? "", invocation.args[1], rt);
}

function makeVarTeam(vars: Vars): PlaceholderBehavior {
    return (rt, invocation) => {
        const key = invocation.args[0] ?? "";
        const teamName = invocation.args[1] ?? "";
        return resolveVar(vars.team(teamName), key, invocation.args[2], rt);
    };
}

function resolveVar(
    holder: VarHolder<string>,
    key: string,
    fallbackRaw: string | undefined,
    rt: Parameters<PlaceholderBehavior>[0],
): Var<any> {
    const fallback = parseValue(rt, fallbackRaw ?? '""');
    return holder.get(key, fallback);
}
