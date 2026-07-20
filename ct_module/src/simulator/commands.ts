import { parseActionsResult, SourceMap } from "htsw";
import type { Action } from "htsw/types";
import type { VarOperation } from "htsw/types";

import {
    getSimulatorVars,
    isSimulatorActive,
    runSimulatorActions,
} from "./session";
import { StringFileLoader } from "../utils/fileLoaders";
import { printDiagnostic } from "../tui/diagnostics";
import { printUI, UIElementText } from "../tui/elements";
import { UIElementTable } from "../tui/tables";

export function registerCommandTriggers(): CommandTrigger[] {
    return [
        register("command", (...args) => commandFunction(args)).setName("function"),
        register("command", (...args) => commandVariable(args)).setName("var"),
        register("command", (...args) => commandEval(args))
            .setName("/")
            .setAliases("eval"),
        register("command", (...args) => commandVars(args)).setName("vars"),
        register("command", (...args) => commandGlobalVars(args)).setName("globalvars"),
        register("command", (...args) => commandTeamVars(args)).setName("teamvars"),
    ];
}

function commandFunction(args: string[]) {
    if (args[0] === "run") {
        const name = args.slice(1).join(" ");
        if (name !== "") {
            const action: Action = { type: "FUNCTION", function: name };
            runSimulatorActions([action]);
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
        runSimulatorActions(result.value);
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

    let holder: { type: "Player" } | { type: "Global" } | { type: "Team"; team?: string };
    let key: string;

    if (target.startsWith("global:")) {
        holder = { type: "Global" };
        key = target.slice("global:".length);
    } else if (target.startsWith("team:")) {
        const parts = target.split(":");
        if (parts.length < 3 || !parts[1] || !parts[2]) {
            ChatLib.chat("&cInvalid team var target. Use team:<team>:<var>");
            return;
        }
        holder = { type: "Team", team: parts[1] };
        key = parts.slice(2).join(":");
    } else {
        holder = { type: "Player" };
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

    runSimulatorActions([action]);
}

function commandVars(args: string[]) {
    if (!isSimulatorActive()) {
        ChatLib.chat("&cNo simulator active.");
        return;
    }
    printVarTable(getSimulatorVars().player, "Player", args[0]);
}

function commandGlobalVars(args: string[]) {
    if (!isSimulatorActive()) {
        ChatLib.chat("&cNo simulator active.");
        return;
    }
    printVarTable(getSimulatorVars().global, "Global", args[0]);
}

function commandTeamVars(args: string[]) {
    if (!isSimulatorActive()) {
        ChatLib.chat("&cNo simulator active.");
        return;
    }
    if (args.length === 0) {
        ChatLib.chat("&cUsage: /teamvars <team> [filter]");
        return;
    }
    printVarTable(getSimulatorVars().team(args[0]), `Team '${args[0]}'`, args[1]);
}

function printVarTable(
    holder: { keys(): Set<string>; get(key: string): { type: string; toDisplayString(): string } },
    label: string,
    filter?: string,
) {
    const keys = holder.keys();
    if (keys.size === 0) {
        ChatLib.chat(`&7No ${label.toLowerCase()} variables set.`);
        return;
    }
    const entries: { key: string; type: string; display: string }[] = [];
    for (const key of keys) {
        if (filter && !key.startsWith(filter)) continue;
        const v = holder.get(key);
        entries.push({ key, type: v.type, display: v.toDisplayString() });
    }
    entries.sort((a, b) => a.key.localeCompare(b.key));
    if (entries.length === 0) {
        ChatLib.chat(`&7No ${label.toLowerCase()} variables match filter "&f${filter}&7".`);
        return;
    }
    const table = new UIElementTable(["Name", "Type", "Value"]);
    for (const e of entries) {
        const typeColor = e.type === "long" ? "&e" : e.type === "double" ? "&d" : "&b";
        table.addRow([
            new UIElementText(`&f${e.key}`),
            new UIElementText(`${typeColor}${e.type}`),
            new UIElementText(`&f${e.display}`),
        ]);
    }
    printUI(table);
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
