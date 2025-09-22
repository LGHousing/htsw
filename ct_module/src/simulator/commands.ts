import * as htsl from "htsl";

import { Simulator } from "./simulator";
import { printDiagnostic } from "../compiler/diagnostics";

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
    const source = args.join(" ").replace("\r", "");

    const sm = new htsl.SourceMap();
    sm.addFile(source, "source.htsl");

    const result = htsl.parse.parseFromSourceMap(sm);
    if (result.diagnostics.length !== 0) {
        for (const diagnostic of result.diagnostics) {
            printDiagnostic(sm, diagnostic);
        }
    } else {
        Simulator.runActions(result.holders[0].actions!.value);
    }
}

function commandVariable(args: string[]) {
    if (args.length != 3) {
        ChatLib.chat(
            "&cInvalid usage: /var [<var>|global:<var>|team:<team>:<var>] [set|inc|dec|mul|div] <value>"
        );
    }
}
