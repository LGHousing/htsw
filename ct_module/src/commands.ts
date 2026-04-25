import { VERSION, SourceMap, parseImportablesResult, Diagnostic } from "htsw";
import type { Condition } from "htsw/types";

import {
    ACTION_MAPPINGS,
    tryGetActionTypeFromDisplayName,
} from "./importer/actionMappings";
import {
    CONDITION_LORE_MAPPINGS,
    tryGetConditionTypeFromDisplayName,
} from "./importer/conditionMappings";
import { parseFieldValue, parseLoreKeyValueLine } from "./importer/loreParsing";
import {
    chatSeparator,
    normalizeFormattingCodes,
    removedFormatting,
} from "./utils/helpers";
import { Simulator } from "./simulator";
import { printDiagnostic, printDiagnostics } from "./tui/diagnostics";
import { recompile } from "./recompile";
import { importImportable } from "./importer/importables";
import { isSyncDebugLoggingEnabled, setSyncDebugLoggingEnabled } from "./importer/debug";
import { diffConditionList, readConditionList } from "./importer/conditions";
import { TaskManager } from "./tasks/manager";
import { FileSystemFileLoader } from "./utils/files";

// Temporary debug hook; safe to delete once condition reading is stable.
const DEBUG_CONDITION_TYPE: Condition["type"] = "REQUIRE_GROUP";
const DEBUG_READ_CONDITION_KEY = Keyboard.KEY_NUMPAD0;
const DEBUG_DUMP_MENU_KEY = Keyboard.KEY_NUMPAD1;
const DEBUG_DUMP_MENU_FALLBACK_KEYS = [Keyboard.KEY_NUMPAD1, Keyboard.KEY_END] as const;
let wasDebugDumpMenuKeyDown = false;
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

function formatDebugCondition(condition: Condition | null): string {
    return condition === null ? "null" : JSON.stringify(condition);
}

function printObservedConditions(conditions: DebugObservedConditions): void {
    ChatLib.chat(`&aObserved conditions (${conditions.length}):`);
    for (const entry of conditions) {
        ChatLib.chat(
            `&7[${entry.index} | slot ${entry.slotId}] &f${formatDebugCondition(entry.condition)}`
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
            `&eedit [${entry.observed.index} | slot ${entry.observed.slotId}] &7from &f${formatDebugCondition(entry.observed.condition)}`
        );
        ChatLib.chat(`&7       to   &f${formatDebugCondition(entry.desired)}`);
    }

    ChatLib.chat(`&bDeletes (${diff.deletes.length}):`);
    for (const entry of diff.deletes) {
        ChatLib.chat(
            `&cdelete [${entry.index} | slot ${entry.slotId}] &f${formatDebugCondition(entry.condition)}`
        );
    }

    ChatLib.chat(`&bAdds (${diff.adds.length}):`);
    for (const condition of diff.adds) {
        ChatLib.chat(`&aadd &f${formatDebugCondition(condition)}`);
    }
}

function dumpCurrentMenu(): void {
    const container = Player.getContainer();
    if (container == null) {
        ChatLib.chat("&cNo open container.");
        return;
    }

    ChatLib.chat(`&aMenu dump (${container.getSize()} slots):`);
    for (let slotId = 0; slotId < container.getSize(); slotId++) {
        const item = container.getStackInSlot(slotId);
        if (item == null) {
            continue;
        }

        const rawName = item.getName();
        ChatLib.chat(
            `&7[slot ${slotId}] &f${removedFormatting(rawName)} &8(raw: ${rawName}&8)`
        );

        const mappedFields = getMappedLoreFieldsForDump(rawName);
        const lore = item.getLore();
        for (const line of lore) {
            const unformattedLine = removedFormatting(line);
            ChatLib.chat(`&8  lore: &7${unformattedLine}`);

            const keyValue = parseLoreKeyValueLine(line);
            if (keyValue === null) {
                continue;
            }

            const field = mappedFields[keyValue.label];
            if (!field) {
                continue;
            }

            const parsedValue = parseFieldValue(field.kind, keyValue.value);
            ChatLib.chat(`&8  field: &b${keyValue.label} &8-> &b${field.prop}`);
            chatLiteral("&8    raw: &7", normalizeFormattingCodes(keyValue.value));
            if (parsedValue === undefined) {
                ChatLib.chat("&8    parsed: &7(summary only; open submenu)");
            } else {
                ChatLib.chat(`&8    parsed: &7${String(parsedValue)}`);
            }
        }
    }
}

function chatLiteral(prefix: string, text: string): void {
    new Message([prefix, new TextComponent(text).setFormatted(false)]).chat();
}

function getMappedLoreFieldsForDump(
    displayName: string
): Record<string, { prop: string; kind: Parameters<typeof parseFieldValue>[0] }> {
    const actionType = tryGetActionTypeFromDisplayName(displayName);
    if (actionType !== undefined) {
        return ACTION_MAPPINGS[actionType].loreFields ?? {};
    }

    const conditionType = tryGetConditionTypeFromDisplayName(displayName);
    if (conditionType !== undefined) {
        return CONDITION_LORE_MAPPINGS[conditionType]?.loreFields ?? {};
    }

    return {};
}

function dumpDebugKeyCodes(): void {
    ChatLib.chat(`&7NUMPAD1=${Keyboard.KEY_NUMPAD1}, END=${Keyboard.KEY_END}`);
    ChatLib.chat(
        `&7NUMPAD1 down=${Keyboard.isKeyDown(Keyboard.KEY_NUMPAD1)}, END down=${Keyboard.isKeyDown(Keyboard.KEY_END)}`
    );
    ChatLib.chat(
        `&7inGui=${Client.isInGui()}, container=${Player.getContainer() == null ? "none" : "open"}`
    );
}

function isDebugDumpMenuKey(keyCode: number): boolean {
    return DEBUG_DUMP_MENU_FALLBACK_KEYS.indexOf(keyCode) !== -1;
}

function isDebugDumpMenuKeyDown(): boolean {
    for (let i = 0; i < DEBUG_DUMP_MENU_FALLBACK_KEYS.length; i++) {
        const keyCode = DEBUG_DUMP_MENU_FALLBACK_KEYS[i];
        if (Keyboard.isKeyDown(keyCode)) {
            return true;
        }
    }

    return false;
}

export function registerCommands() {
    register("command", (...args) => commandHtsw(args)).setName("htsw");
    register("command", (...args) => commandImport(args)).setName("import");
    register("command", (...args) => commandSimulator(args))
        .setName("simulator")
        .setAliases("sim");

    register("tick", () => {
        const isDown = isDebugDumpMenuKeyDown();
        if (!isDown) {
            wasDebugDumpMenuKeyDown = false;
            return;
        }

        if (wasDebugDumpMenuKeyDown || !Client.isInGui()) {
            return;
        }

        wasDebugDumpMenuKeyDown = true;
        dumpCurrentMenu();
    });

    register("guiRender", () => {
        const isDown = isDebugDumpMenuKeyDown();
        if (!isDown) {
            wasDebugDumpMenuKeyDown = false;
            return;
        }

        if (wasDebugDumpMenuKeyDown || Player.getContainer() == null) {
            return;
        }

        wasDebugDumpMenuKeyDown = true;
        dumpCurrentMenu();
    });

    register("guiKey", (_char, keyCode, _gui, event) => {
        if (isDebugDumpMenuKey(keyCode)) {
            cancel(event);
            dumpCurrentMenu();
            return;
        }

        if (keyCode !== DEBUG_READ_CONDITION_KEY) {
            return;
        }

        cancel(event);
        ChatLib.chat(`&7HTSW debug: reading ${DEBUG_CONDITION_TYPE}...`);

        TaskManager.run(async (ctx) => {
            const conditions = await readConditionList(ctx);
            const diff = diffConditionList(conditions, DEBUG_DESIRED_CONDITIONS);

            printObservedConditions(conditions);
            printConditionDiff(diff);
        }).catch((err) => {
            ChatLib.chat(`&cHTSW debug failed: ${String(err)}`);
        });
    });
}

function commandHtsw(args: string[]) {
    if (args.length >= 2 && args[0] === "debug" && args[1] === "sync") {
        const value = args[2]?.toLowerCase();
        if (value === "on" || value === "true") {
            setSyncDebugLoggingEnabled(true);
        } else if (value === "off" || value === "false") {
            setSyncDebugLoggingEnabled(false);
        }

        ChatLib.chat(
            `&7HTSW sync debug: ${isSyncDebugLoggingEnabled() ? "&aon" : "&coff"}`
        );
        ChatLib.chat("&8Usage: &7/htsw debug sync on|off");
        return;
    }

    if (args.length >= 2 && args[0] === "debug" && args[1] === "dump-menu") {
        dumpCurrentMenu();
        return;
    }

    if (args.length >= 2 && args[0] === "debug" && args[1] === "key-codes") {
        dumpDebugKeyCodes();
        return;
    }

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

function stripSurroundingQuotes(s: string): string {
    if (s.length >= 2 && s.charAt(0) === "\"" && s.charAt(s.length - 1) === "\"") {
        return s.slice(1, s.length - 1);
    }
    return s;
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
