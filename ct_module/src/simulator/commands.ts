import { parseActionsResult, SourceMap } from "htsw";
import type { Action } from "htsw/types";
import type { VarOperation } from "htsw/types";

import { Simulator } from "./simulator";
import { StringFileLoader } from "../utils/files";
import { printDiagnostic } from "../tui/diagnostics";

export function registerCommandTriggers(): CommandTrigger[] {
    return [
        register("command", (...args) => commandFunction(args)).setName("function"),
        register("command", (...args) => commandVariable(args)).setName("var"),
        register("command", (...args) => commandEval(args))
            .setName("/")
            .setAliases("eval"),
    ];
}

function commandFunction(args: string[]) {
    if (args[0] === "run") {
        const name = args.slice(1).join(" ");
        if (name !== "") {
            const action: Action = { type: "FUNCTION", function: name };
            Simulator.runActions([action]);
        } else {
            ChatLib.chat("&cInvalid usage: run <name>");
        }
        return;
    }
}

function commandEval(args: string[]) {
    const src = args.join(" ").replace("\r", "");
    const sm = new SourceMap(new StringFileLoader(src));

    const result = parseActionsResult(sm, "eval");

    for (const diag of result.diagnostics) {
        printDiagnostic(sm, diag);
    }

    if (!result.gcx.isFailed()) {
        Simulator.runActions(result.value);
    }
}

function commandVariable(args: string[]) {
    if (args.length !== 3) {
        ChatLib.chat(
            "&cInvalid usage: /var [<var>|global:<var>|team:<team>:<var>] [set|inc|dec|mul|div] <value>"
        );
        return;
    }

    const [target, opRaw, value] = args;
    const op = parseVarOp(opRaw);
    if (!op) {
        ChatLib.chat("&cInvalid op. Use: set|inc|dec|mul|div");
        return;
    }

    let holder: { type: "player" } | { type: "global" } | { type: "team"; team?: string };
    let key: string;

    if (target.startsWith("global:")) {
        holder = { type: "global" };
        key = target.slice("global:".length);
    } else if (target.startsWith("team:")) {
        const parts = target.split(":");
        if (parts.length < 3 || !parts[1] || !parts[2]) {
            ChatLib.chat("&cInvalid team var target. Use team:<team>:<var>");
            return;
        }
        holder = { type: "team", team: parts[1] };
        key = parts.slice(2).join(":");
    } else {
        holder = { type: "player" };
        key = target;
    }

    if (!key) {
        ChatLib.chat("&cVariable name cannot be empty.");
        return;
    }

    const action: Action = {
        type: "CHANGE_VAR",
        holder,
        key,
        op,
        value,
    };

    Simulator.runActions([action]);
}

function parseVarOp(op: string): VarOperation | undefined {
    const normalized = op.toLowerCase();
    if (normalized === "set") return "Set";
    if (normalized === "inc") return "Increment";
    if (normalized === "dec") return "Decrement";
    if (normalized === "mul") return "Multiply";
    if (normalized === "div") return "Divide";
    return undefined;
}
