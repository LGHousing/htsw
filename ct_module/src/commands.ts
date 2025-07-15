import * as htsl from "htsl";

import { chatSeparator } from "./helpers";
import { Simulator } from "./simulator";
import { printDiagnostic } from "./compiler/diagnostics";

export function registerCommands() {
    register("command",
        (...args) => commandHtsl(args)
    ).setName("htsl").setAliases("htsw");
    register("command",
        (...args) => commandSimulator(args)
    ).setName("simulator").setAliases("sim");
}

function commandHtsl(args: string[]) {
    ChatLib.chat(`&7${chatSeparator()}`);
    const title = `&e&lHTSW &f&l${htsl.helpers.VERSION}`
    ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
    const subtitle = `&fCreated by @sndyx and @j_sse`;
    ChatLib.chat(`${ChatLib.getCenteredText(subtitle)}`);
    ChatLib.chat("");
    ChatLib.chat("&f/import &7- Import actions from HTSL files");
    ChatLib.chat("&f/simulator &7- Simulate actions from HTSL files");
    ChatLib.chat(`&7${chatSeparator()}`);
}

function commandSimulator(args: string[]) {
    if (args.length === 0) {
        ChatLib.chat(`&7${chatSeparator()}`);
        const title = `&e&lHTSW &fSimulator Runtime &f&l${htsl.helpers.VERSION}`
        ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
        ChatLib.chat("");
        ChatLib.chat("&f/simulator [start <path> | restart | stop ]")
        ChatLib.chat("");
        ChatLib.chat("&f/import &7- Import actions from HTSL files");
        ChatLib.chat("&f/simulate &7- Simulate actions from HTSL files");
        ChatLib.chat(`&7${chatSeparator()}`);
    }

    if (args[0] === "start") {
        if (args.length === 1) {
            ChatLib.chat("&cUsage: /simulator start <path>");
            return;
        }

        const file = FileLib.read(args[0]);
        const sm = new htsl.SourceMap();
        sm.addFile(file, args[0]);

        const result = htsl.parse.parseFromSourceMap(sm);

        if (result.diagnostics.length !== 0) {
            for (const diagnostic of result.diagnostics) {
                printDiagnostic(sm, diagnostic);
            }
        } else {
            Simulator.start(sm, result.holders);
            ChatLib.chat("&aSimulator started.")
        }
        return;
    }

    if (args[0] === "restart") {

        return;
    }

    if (args[0] === "stop") {
        Simulator.stop();
        ChatLib.chat("&aSimulator stopped.")
        return;
    }
}