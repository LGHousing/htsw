import {
    PlaceholderBehaviors,
    type PlaceholderBehavior,
} from "../behaviors/placeholders";
import { parseValue, VarLong, type Var } from "../vars";
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
            .with("var.team", makeVarTeam(vars))
            .with("stat.player", makeStatPlayer(vars))
            .with("stat.global", makeStatGlobal(vars))
            .with("stat.team", makeStatTeam(vars));
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

function makeStatPlayer(vars: Vars): PlaceholderBehavior {
    return (rt, invocation) =>
        resolveStat(vars.player, invocation.args[0] ?? "", rt);
}

function makeStatGlobal(vars: Vars): PlaceholderBehavior {
    return (rt, invocation) =>
        resolveStat(vars.global, invocation.args[0] ?? "", rt);
}

function makeStatTeam(vars: Vars): PlaceholderBehavior {
    return (rt, invocation) => {
        const key = invocation.args[0] ?? "";
        const teamName = invocation.args[1] ?? "";
        return resolveStat(vars.team(teamName), key, rt);
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

function resolveStat(
    holder: VarHolder<string>,
    key: string,
    rt: Parameters<PlaceholderBehavior>[0],
): Var<any> {
    const value = holder.get(key, VarLong.fromNumber(0));
    if (value instanceof VarLong) return value;
    return VarLong.fromNumber(0);
}
