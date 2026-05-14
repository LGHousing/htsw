import {
    PlaceholderBehaviors,
    type PlaceholderBehavior,
} from "../behaviors/placeholders";
import { parseValue, type Var } from "../vars";
import type { VarHolder } from "./varHolder";
import type { Vars } from "./vars";

// Opinionated default PlaceholderBehaviors with var.player / var.global /
// var.team resolution wired to the supplied storage. Extends
// PlaceholderBehaviors.default() so random.* and any user-defined .with(...)
// continue to work.
export class SimplePlaceholderBehaviors extends PlaceholderBehaviors {
    constructor(vars: Vars) {
        super();
        const defaults = PlaceholderBehaviors.default();
        for (const [type, handler] of entriesOf(defaults)) {
            this.with(type, handler);
        }
        this.with("var.player", makeVarPlayer(vars))
            .with("var.global", makeVarGlobal(vars))
            .with("var.team", makeVarTeam(vars));
    }
}

function entriesOf(
    behaviors: PlaceholderBehaviors,
): Array<[any, PlaceholderBehavior]> {
    const handlers = (behaviors as unknown as {
        handlers: Record<string, PlaceholderBehavior>;
    }).handlers;
    return Object.entries(handlers) as Array<[any, PlaceholderBehavior]>;
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
