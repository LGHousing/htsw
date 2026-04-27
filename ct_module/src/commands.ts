import { VERSION, SourceMap, parseImportablesResult, Diagnostic } from "htsw";

import { chatSeparator } from "./utils/helpers";
import { Simulator } from "./simulator";
import { printDiagnostic, printDiagnostics } from "./tui/diagnostics";
import { recompile } from "./recompile";
import { importImportable } from "./importables/imports";
import { createItemRegistry } from "./importables/itemRegistry";
import { TaskManager } from "./tasks/manager";
import { FileSystemFileLoader } from "./utils/files";
import { stripSurroundingQuotes } from "./utils/strings";

function printCommandError(sm: SourceMap, err: unknown): void {
    if (err instanceof Diagnostic) {
        if (err.spans.length > 0) {
            printDiagnostic(sm, err);
        } else {
            ChatLib.chat(`&c${err.message}`);
        }
        return;
    }

    if (err instanceof Error) {
        ChatLib.chat(`&c${err.message}`);
        if (err.stack) {
            const firstStackLine = err.stack.split("\n")[1];
            if (firstStackLine) {
                ChatLib.chat(`&7${firstStackLine.trim()}`);
            }
        }
        return;
    }

    ChatLib.chat(`&c${String(err)}`);
}

export function registerCommands() {
    register("command", (...args) => commandHtsw(args)).setName("htsw");
    register("command", (...args) => commandImport(args)).setName("import");
    register("command", (...args) => commandSimulator(args))
        .setName("simulator")
        .setAliases("sim");
}

function commandHtsw(args: string[]) {
    if (args.length > 0 && args[0] === "recompile") {
        recompile();
        return;
    }

    ChatLib.chat(`&7${chatSeparator()}`);
    const title = `&e&lHTSW &f&l${VERSION}`;
    ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
    const subtitle = `&fCreated by @sndyx, @j_sse, and @callanftw`;
    ChatLib.chat(`${ChatLib.getCenteredText(subtitle)}`);
    ChatLib.chat("");
    ChatLib.chat("&f/import &7- Import actions from HTSL files");
    ChatLib.chat("&f/simulator &7- Simulate actions from HTSL files");
    ChatLib.chat(`&7${chatSeparator()}`);
}

function commandImport(args: string[]) {
    if (args.length === 0) {
        ChatLib.chat(`&7${chatSeparator()}`);
        const title = `&e&lHTSW &fImporter &f&l${VERSION}`;
        ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
        ChatLib.chat("");
        ChatLib.chat("&f/import [path]");
        ChatLib.chat(`&7${chatSeparator()}`);
        return;
    }

    const sm = new SourceMap(new FileSystemFileLoader());
    // Strip a single pair of surrounding quotes — users naturally type
    // `/import "C:\path with spaces\import.json"` and ChatTriggers passes
    // those quotes through verbatim, which Java's Paths.get rejects.
    const importPath = stripSurroundingQuotes(args.join(" "));
    let result: ReturnType<typeof parseImportablesResult>;
    try {
        result = parseImportablesResult(sm, importPath);
    } catch (err) {
        ChatLib.chat("&cImport failed while parsing.");
        printCommandError(sm, err);
        return;
    }

    printDiagnostics(sm, result.diagnostics);

    if (result.gcx.isFailed()) {
        ChatLib.chat("&cImport failed.");
        return;
    }

    TaskManager.run(async (ctx) => {
        ctx.displayMessage("&aImport started.");
        const itemRegistry = createItemRegistry(result.value, result.gcx);
        const ordered = [
            ...result.value.filter((i) => i.type === "ITEM"),
            ...result.value.filter((i) => i.type !== "ITEM"),
        ];
        for (const importable of ordered) {
            try {
                await importImportable(ctx, importable, itemRegistry);
            } catch (e) {
                if (e instanceof Diagnostic) {
                    printDiagnostic(sm, e);
                } else {
                    ctx.displayMessage(`&cFailed to import: ${e}`);
                }
            }
        }
    }).catch((err) => {
        ChatLib.chat("&cImport failed.");
        printCommandError(sm, err);
    });
}

function commandSimulator(args: string[]) {
    if (args.length === 0) {
        ChatLib.chat(`&7${chatSeparator()}`);
        const title = `&e&lHTSW &fSimulator Runtime &f&l${VERSION}`;
        ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
        ChatLib.chat("");
        ChatLib.chat("&f/simulator [start [path] | restart | stop ]");
        ChatLib.chat("");
        ChatLib.chat("&f/function run <function> &7- Run a function");
        ChatLib.chat("&f// <htsl> &7- Evaluate HTSL code");
        ChatLib.chat(`&7${chatSeparator()}`);
    }

    if (args[0] === "start") {
        if (Simulator.isActive) {
            Simulator.stop();
            ChatLib.chat("&aSimulator stopped.");
        }

        const sm = new SourceMap(new FileSystemFileLoader());
        const result = parseImportablesResult(sm, args[1]);

        printDiagnostics(sm, result.diagnostics);

        if (result.gcx.isFailed()) {
            const errCount = result.diagnostics.filter(
                (it) => it.level === "error"
            ).length;
            printDiagnostic(
                sm,
                Diagnostic.error(`Simulate failed with ${errCount} errors`)
            );
        } else {
            Simulator.start(sm, result.value, result.spans);
            ChatLib.chat("&aSimulator started.");
        }

        return;
    }

    if (args[0] === "restart") {
        if (!Simulator.isActive) {
            ChatLib.chat("&cNo simulator active.");
        } else {
            Simulator.restart();
            ChatLib.chat("&aSimulator restarted.");
        }
        return;
    }

    if (args[0] === "stop") {
        Simulator.stop();
        ChatLib.chat("&aSimulator stopped.");
        return;
    }
}
