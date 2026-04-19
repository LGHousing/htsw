import {
    VERSION,
    SourceMap,
    parseImportablesResult,
    Diagnostic,
} from "htsw";
import type { Condition } from "htsw/types";

import { chatSeparator } from "./utils/helpers";
import { Simulator } from "./simulator";
import { printDiagnostic, printDiagnostics } from "./tui/diagnostics";
import { recompile } from "./recompile";
import { importImportable } from "./importer/importables";
import { diffConditionList, readConditionList, readOpenCondition } from "./importer/conditions";
import { TaskManager } from "./tasks/manager";
import { FileSystemFileLoader } from "./utils/files";

// Temporary debug hook; safe to delete once condition reading is stable.
const DEBUG_CONDITION_TYPE: Condition["type"] = "REQUIRE_GROUP";
const DEBUG_READ_CONDITION_KEY = Keyboard.KEY_NUMPAD0;
const DEBUG_DESIRED_CONDITIONS: Condition[] = [
    {
        type: "REQUIRE_GROUP",
        group: "Resident",
        includeHigherGroups: true,
    },
];
type DebugObservedConditions = Awaited<ReturnType<typeof readConditionList>>;
type DebugConditionDiff = ReturnType<typeof diffConditionList>;

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

function formatDebugCondition(condition: Condition): string {
    return JSON.stringify(condition);
}

function printObservedConditions(conditions: DebugObservedConditions): void {
    ChatLib.chat(`&aObserved conditions (${conditions.length}):`);
    for (const entry of conditions) {
        ChatLib.chat(
            `&7[${entry.index} | slot ${entry.slotId}] &f${formatDebugCondition(entry.condition)}`,
        );
    }
}

function printConditionDiff(diff: DebugConditionDiff): void {
    ChatLib.chat(`&bDesired (${DEBUG_DESIRED_CONDITIONS.length}):`);
    for (const condition of DEBUG_DESIRED_CONDITIONS) {
        ChatLib.chat(`&7[want] &f${formatDebugCondition(condition)}`);
    }

    ChatLib.chat(`&bEdits (${diff.edits.length}):`);
    for (const entry of diff.edits) {
        ChatLib.chat(
            `&eedit [${entry.observed.index} | slot ${entry.observed.slotId}] &7from &f${formatDebugCondition(entry.observed.condition)}`,
        );
        ChatLib.chat(`&7       to   &f${formatDebugCondition(entry.desired)}`);
    }

    ChatLib.chat(`&bDeletes (${diff.deletes.length}):`);
    for (const entry of diff.deletes) {
        ChatLib.chat(
            `&cdelete [${entry.index} | slot ${entry.slotId}] &f${formatDebugCondition(entry.condition)}`,
        );
    }

    ChatLib.chat(`&bAdds (${diff.adds.length}):`);
    for (const condition of diff.adds) {
        ChatLib.chat(`&aadd &f${formatDebugCondition(condition)}`);
    }
}

export function registerCommands() {
    register("command", (...args) => commandHtsw(args)).setName("htsw");
    register("command", (...args) => commandImport(args)).setName("import");
    register("command", (...args) => commandSimulator(args))
        .setName("simulator")
        .setAliases("sim");

    register("guiKey", (_char, keyCode, _gui, event) => {
        if (keyCode !== DEBUG_READ_CONDITION_KEY) {
            return;
        }

        cancel(event);
        ChatLib.chat(`&7HTSW debug: reading ${DEBUG_CONDITION_TYPE}...`);

        TaskManager.run(async (ctx) => {
            const conditions = await readConditionList(ctx);
            if (conditions.length > 0) {
                const diff = diffConditionList(conditions, DEBUG_DESIRED_CONDITIONS);

                printObservedConditions(conditions);
                printConditionDiff(diff);
                return;
            }

            const condition = await readOpenCondition(ctx, DEBUG_CONDITION_TYPE);
            ChatLib.chat(
                `&aRead ${DEBUG_CONDITION_TYPE}: &f${JSON.stringify(condition)}`,
            );
        }).catch((err) => {
            ChatLib.chat(`&cHTSW debug failed: ${String(err)}`);
        });
    });
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
    let result: ReturnType<typeof parseImportablesResult>;
    try {
        result = parseImportablesResult(sm, args.join(" "));
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
        for (const importable of result.value) {
            try {
                await importImportable(ctx, importable);
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
                (it) => it.level === "error",
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
