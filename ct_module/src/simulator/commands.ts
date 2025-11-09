import { parseIrActions, SourceMap } from "htsw";

import { Simulator } from "./simulator";
import { StringFileLoader } from "../helpers";
import { printDiagnostic } from "../tui/diagnostics";

export function registerCommandTriggers(): CommandTrigger[] {
    return [
        register("command", (...args) => commandFunction(args)).setName("function"),
        register("command", (...args) => commandEval(args))
            .setName("/")
            .setAliases("eval"),
    ];
}

function commandFunction(args: string[]) {
    if (args[0] === "run") {
        const name = args.slice(1).join(" ");
        if (name !== "") {
            console.log(name);
            Simulator.runFunction(name);
        } else {
            ChatLib.chat("&cInvalid usage: run <name>");
        }
        return;
    }
}

function commandEval(args: string[]) {
    console.log(args);

    const src = args.join(" ").replace("\r", "");
    const sm = new SourceMap(new StringFileLoader(src));

    const result = parseIrActions(sm, "eval");

    for (const diag of result.diagnostics) {
        printDiagnostic(sm, diag);
    }

    if (!result.gcx.isFailed()) {
        Simulator.runActions(result.value);
    }
}

function commandVariable(args: string[]) {
    if (args.length != 3) {
        ChatLib.chat(
            "&cInvalid usage: /var [<var>|global:<var>|team:<team>:<var>] [set|inc|dec|mul|div] <value>"
        );
    }
}
