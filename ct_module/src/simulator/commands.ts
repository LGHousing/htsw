import { Simulator } from "./simulator";

export function registerCommandTriggers(): CommandTrigger[] {
    return [
        register("command", 
            (...args) => commandFunction(args)
        ).setName("function"),
    ];
}

function commandFunction(args: string[]) {
    if (args[0] === "run") {
        const name = args.slice(1).join(" ");
        if (name !== "") {
            console.log(name);
            Simulator.runFunction(name)
        } else {
            ChatLib.chat("&cInvalid usage: run <name>");
        }
        return;
    }
}

function commandVariable(args: string[]) {
    if (args.length != 3) {
        

        ChatLib.chat("&cInvalid usage: /var [<var>|global:<var>|team:<team>:<var>] [set|inc|dec|mul|div] <value>")
    }
}