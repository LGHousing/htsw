import * as htsl from "htsl";

import { chatSeparator, chatWidth } from "./helpers";
import { Simulator } from "./simulator";
import { printDiagnostic } from "./compiler/diagnostics";
import { Importer } from "./importer/importer";

export function registerCommands() {
    register("command", (...args) => commandHtsl(args))
        .setName("htsl")
        .setAliases("htsw");
    register("command", (...args) => commandImport(args))
        .setName("import")
    register("command", (...args) => commandSimulator(args))
        .setName("simulator")
        .setAliases("sim");
}

function commandHtsl(args: string[]) {
    ChatLib.chat(`&7${chatSeparator()}`);
    const title = `&e&lHTSW &f&l${htsl.helpers.VERSION}`;
    ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
    const subtitle = `&fCreated by @sndyx and @j_sse`;
    ChatLib.chat(`${ChatLib.getCenteredText(subtitle)}`);
    ChatLib.chat("");
    ChatLib.chat("&f/import &7- Import actions from HTSL files");
    ChatLib.chat("&f/simulator &7- Simulate actions from HTSL files");
    ChatLib.chat(`&7${chatSeparator()}`);
}

function commandImport(args: string[]) {
    if (args.length === 0) {
        ChatLib.chat(`&7${chatSeparator()}`);
        const title = `&e&lHTSW &fImporter &f&l${htsl.helpers.VERSION}`;
        ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
        ChatLib.chat("");
        ChatLib.chat("&f/import [path]");
        ChatLib.chat(`&7${chatSeparator()}`);
    }

    const sm = new htsl.SourceMap();
    const file = FileLib.read(args[0]);
    sm.addFile(file, args[0]);

    const result = htsl.parse.parseFromSourceMap(sm);

    if (result.diagnostics.length !== 0) {
        for (const diagnostic of result.diagnostics) {
            printDiagnostic(sm, diagnostic);
        }
    } else {
        const holders: htsl.ActionHolder[] = htsl.actions(file);
        Importer.import(holders);
        ChatLib.chat("&aImport started.");
    }
    return;
}

function commandSimulator(args: string[]) {
    if (args.length === 0) {
        ChatLib.chat(`&7${chatSeparator()}`);
        const title = `&e&lHTSW &fSimulator Runtime &f&l${htsl.helpers.VERSION}`;
        ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
        ChatLib.chat("");
        ChatLib.chat("&f/simulator [start [path] | restart | stop ]");
        ChatLib.chat("");
        ChatLib.chat("&f/function run <function> &7- Run a function");
        ChatLib.chat("&f// <htsl> &7- Evaluate HTSL code");
        ChatLib.chat(`&7${chatSeparator()}`);
    }

    if (args[0] === "start") {
        const sm = new htsl.SourceMap();
        if (args.length > 1) {
            const file = FileLib.read(args[1]);
            sm.addFile(file, args[1]);
        }

        const result = htsl.parse.parseFromSourceMap(sm);

        if (result.diagnostics.length !== 0) {
            for (const diagnostic of result.diagnostics) {
                printDiagnostic(sm, diagnostic);
            }
        } else {
            Simulator.start(sm, result.holders);
            ChatLib.chat("&aSimulator started.");
        }
        return;
    }

    if (args[0] === "restart") {
        return;
    }

    if (args[0] === "stop") {
        Simulator.stop();
        ChatLib.chat("&aSimulator stopped.");
        return;
    }
}
