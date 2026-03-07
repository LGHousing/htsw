import { VERSION, SourceMap, parseImportablesResult, Diagnostic } from "htsw";

import { chatSeparator, FileSystemFileLoader } from "./helpers";
import { Simulator } from "./simulator";
import { printDiagnostic, printDiagnostics } from "./tui/diagnostics";
import { recompile } from "./recompile";
import { importImportable } from "./importer/importables";
import { TaskManager } from "./tasks/manager";
import { waitForMenuToLoad } from "./importer/helpers";
import { runExporter } from "./exporter";

export function registerCommands() {
    register("command", (...args) => commandFRICK(args)).setName("frick");
    register("command", (...args) => commandHtsw(args)).setName("htsw");
    register("command", (...args) => commandImport(args)).setName("import");
    register("command", (...args) => commandExport(args)).setName("export");
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
    const subtitle = `&fCreated by @sndyx and @j_sse`;
    ChatLib.chat(`${ChatLib.getCenteredText(subtitle)}`);
    ChatLib.chat("");
    ChatLib.chat("&f/import &7- Import actions from HTSL files");
    ChatLib.chat("&f/export &7- Export house functions to HTSL files");
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

    const importJsonPath = args.join(" ");
    const sm = new SourceMap(new FileSystemFileLoader());
    const result = parseImportablesResult(sm, importJsonPath);

    printDiagnostics(sm, result.diagnostics);

    TaskManager.run(async (ctx) => {
        if (!result.gcx.isFailed()) {
            ctx.displayMessage("&aImport started.");
            for (const importable of result.value) {
                try {
                    await importImportable(ctx, importable, { importJsonPath });
                } catch (e) {
                    if (e instanceof Diagnostic) {
                        printDiagnostic(sm, e);
                    } else {
                        ctx.displayMessage(`&cFailed to import: ${e}`);
                    }
                }
            }
        } else {
            ctx.displayMessage("&cImport failed.");
        }
    });
}

function parseExportArgs(args: string[]): { path?: string; mode?: "strict" | "incremental"; error?: string } {
    if (args.length === 0) {
        return { error: "Missing import.json path" };
    }

    const pathParts: string[] = [];
    let mode: "strict" | "incremental" | undefined;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--mode") {
            const modeArg = args[i + 1];
            if (!modeArg) {
                return { error: "Missing value for --mode (strict|incremental)" };
            }
            if (modeArg !== "strict" && modeArg !== "incremental") {
                return { error: `Invalid mode: ${modeArg}` };
            }
            mode = modeArg;
            i++;
            continue;
        }
        if (arg.startsWith("--mode=")) {
            const modeArg = arg.slice("--mode=".length);
            if (modeArg !== "strict" && modeArg !== "incremental") {
                return { error: `Invalid mode: ${modeArg}` };
            }
            mode = modeArg;
            continue;
        }

        pathParts.push(arg);
    }

    if (pathParts.length === 0) {
        return { error: "Missing import.json path" };
    }

    return { path: pathParts.join(" "), mode };
}

function commandExport(args: string[]) {
    if (args.length === 0) {
        ChatLib.chat(`&7${chatSeparator()}`);
        const title = `&e&lHTSW &fExporter &f&l${VERSION}`;
        ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
        ChatLib.chat("");
        ChatLib.chat("&f/export <import-json-path> [--mode strict|incremental]");
        ChatLib.chat("&7Default mode: strict");
        ChatLib.chat(`&7${chatSeparator()}`);
        return;
    }

    const parsed = parseExportArgs(args);
    if (parsed.error || !parsed.path) {
        ChatLib.chat(`&c${parsed.error ?? "Invalid export arguments"}`);
        return;
    }

    const mode = parsed.mode ?? "strict";
    TaskManager.run(async (ctx) => {
        try {
            const { summary, warnings } = await runExporter(ctx, parsed.path!, mode);
            ctx.displayMessage("&aExport finished.");
            ctx.displayMessage(`&7Discovered functions: &f${summary.discovered}`);
            ctx.displayMessage(`&7Scanned: &f${summary.scanned}`);
            if (summary.mode === "incremental") {
                ctx.displayMessage(`&7Reused confident: &f${summary.reused}`);
            }
            ctx.displayMessage(`&7Mismatches downgraded: &f${summary.mismatches}`);
            ctx.displayMessage(`&7Written files: &f${summary.exported}`);
            ctx.displayMessage(`&7Unsure entries: &f${summary.unsure}`);
            for (const warning of warnings) {
                ctx.displayMessage(`&e${warning}`);
            }
        } catch (e) {
            ctx.displayMessage(`&cExport failed: ${e}`);
        }
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
                (it: any) => it.level === "error",
            ).length;
            printDiagnostic(
                sm,
                Diagnostic.error(`Simulate failed with ${errCount} errors`),
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

function commandFRICK(args: string[]) {
    TaskManager.run(async (ctx) => {
        ctx.runCommand("/hmenu");
        await waitForMenuToLoad(ctx);
        for (let i = 0; i < 10; i++) {
            ctx.getItemSlot("Systems").click();
            await waitForMenuToLoad(ctx);
            ctx.getItemSlot("Go Back").click();
            await waitForMenuToLoad(ctx);
            await ctx.sleep(100);
        }
    });
}
