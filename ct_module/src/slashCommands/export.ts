import { TaskManager } from "../tasks/manager";
import type TaskContext from "../tasks/context";
import { exportAllFunctions } from "../importables/functions/exportAll";
import { exportAllEvents } from "../importables/events/exportAll";
import { exportAllMenus } from "../importables/menus/exportAll";
import { exportAllRegions } from "../importables/regions/exportAll";
import { exportAllCommands } from "../importables/commands/exportAll";
import { exportAllNpcs } from "../importables/npcs/exportAll";
import { listAllFunctionNames } from "../importables/functions/listFunctions";
import { createExportProgressSink } from "../gui/right-panel/import-tab/exportProgress";
import { isTaskRunning, setTaskRunning } from "../tasks/runningState";
import { resetEventContainers } from "../tasks/specifics/waitFor";
import { getCurrentHousingUuid } from "../importCache";
import { traceError, traceRecord } from "../housingSync/trace/taskTrace";
import { clearActiveExportContext, setActiveExportContext } from "../exporter/activeExport";
import {
    defaultExportRoot,
    readEventNamesFromImportJson,
    readFunctionNamesFromImportJson,
    readMenuNamesFromImportJson,
    readCommandNamesFromImportJson,
    readNpcEntriesFromImportJson,
    functionExportReferencesExist,
    readRegionNamesFromImportJson,
    resolveModuleRelativePath,
} from "../project/paths";
import { chatSeparator, stripSurroundingQuotes } from "../utils/helpers";
import { VERSION } from "htsw";

type ExportDestination = { rootDir: string; importJsonPath: string };

type ExportBatchRequest =
    | { type: "FUNCTION"; names?: readonly string[]; skipExisting?: boolean }
    | { type: "EVENT"; names?: readonly string[]; skipExisting?: boolean }
    | { type: "MENU"; names?: readonly string[]; skipExisting?: boolean }
    | { type: "REGION"; names?: readonly string[]; skipExisting?: boolean }
    | { type: "COMMAND"; names?: readonly string[]; skipExisting?: boolean }
    | {
          type: "NPC";
          entries?: ReturnType<typeof readNpcEntriesFromImportJson>;
          skipExisting?: boolean;
      };

type NamedExportType = Exclude<ExportBatchRequest["type"], "EVENT" | "NPC">;

const EXPORT_TYPES: { token: string; type: ExportBatchRequest["type"] }[] = [
    { token: "function", type: "FUNCTION" },
    { token: "event", type: "EVENT" },
    { token: "menu", type: "MENU" },
    { token: "region", type: "REGION" },
    { token: "command", type: "COMMAND" },
    { token: "npc", type: "NPC" },
];

const NAMED_EXPORT_TYPES: { token: string; type: NamedExportType }[] = [
    { token: "function", type: "FUNCTION" },
    { token: "menu", type: "MENU" },
    { token: "region", type: "REGION" },
    { token: "command", type: "COMMAND" },
];

function trimTrailingSlashes(path: string): string {
    let end = path.length;
    while (end > 0) {
        const ch = path.charAt(end - 1);
        if (ch !== "/" && ch !== "\\") break;
        end--;
    }
    return path.substring(0, end);
}

function normalizeSlashes(path: string): string {
    return path.split("\\").join("/");
}

function dirname(path: string): string {
    const norm = normalizeSlashes(path);
    const slash = norm.lastIndexOf("/");
    if (slash <= 0) return ".";
    return norm.substring(0, slash);
}

function endsWithIgnoreCase(value: string, suffix: string): boolean {
    if (value.length < suffix.length) return false;
    return value.substring(value.length - suffix.length).toLowerCase() === suffix.toLowerCase();
}

function tokenizeQuoted(args: readonly string[]): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        if (arg.length >= 2 && arg.charAt(0) === '"' && arg.charAt(arg.length - 1) === '"') {
            out.push(arg.substring(1, arg.length - 1));
            i++;
            continue;
        }
        if (arg.charAt(0) === '"') {
            const parts: string[] = [arg.substring(1)];
            i++;
            let closed = false;
            while (i < args.length) {
                const next = args[i];
                if (next.length > 0 && next.charAt(next.length - 1) === '"') {
                    parts.push(next.substring(0, next.length - 1));
                    i++;
                    closed = true;
                    break;
                }
                parts.push(next);
                i++;
            }
            void closed;
            out.push(parts.join(" "));
            continue;
        }
        out.push(arg);
        i++;
    }
    return out;
}

function exportDestination(
    explicitPath: string | undefined
): { rootDir: string; importJsonPath: string } | null {
    if (explicitPath === undefined) return null;
    const path = resolveModuleRelativePath(trimTrailingSlashes(explicitPath));
    if (endsWithIgnoreCase(path, ".json")) {
        return { rootDir: dirname(path), importJsonPath: normalizeSlashes(path) };
    }
    const rootDir = normalizeSlashes(path);
    return { rootDir, importJsonPath: `${rootDir}/import.json` };
}

async function resolveExportDestination(
    ctx: TaskContext,
    explicitPath: string | undefined
): Promise<ExportDestination> {
    const explicitDestination = exportDestination(explicitPath);
    if (explicitDestination !== null) return explicitDestination;
    const uuid = await getCurrentHousingUuid(ctx);
    const rootDir = defaultExportRoot(uuid);
    return { rootDir, importJsonPath: `${rootDir}/import.json` };
}

function notYetExportedFunctionNames(
    importJsonPath: string,
    liveNames: readonly string[]
): { names: string[]; skipped: number; missingTargets: number } {
    const declared = new Set(readFunctionNamesFromImportJson(importJsonPath));
    const names: string[] = [];
    let skipped = 0;
    let missingTargets = 0;

    for (let i = 0; i < liveNames.length; i++) {
        const name = liveNames[i];
        if (!declared.has(name)) {
            names.push(name);
            continue;
        }

        if (functionExportReferencesExist(importJsonPath, name)) {
            skipped++;
            continue;
        }

        missingTargets++;
        names.push(name);
    }

    return { names, skipped, missingTargets };
}

function isTypeToken(token: string | undefined, singular: string): boolean {
    return token === singular || token === `${singular}s`;
}

function parseIntegerToken(token: string | undefined, label: string): number {
    if (token === undefined || !/^-?\d+$/.test(token)) {
        throw new Error(`Expected integer ${label}.`);
    }
    return Number(token);
}

function pathArgument(tokens: readonly string[], start: number): string | undefined {
    const parts = tokens.slice(start);
    const raw = parts.length > 0 ? parts.join(" ") : "";
    return raw.length > 0 ? stripSurroundingQuotes(raw) : undefined;
}

function exportTypeFromToken(token: string | undefined): ExportBatchRequest["type"] | null {
    for (let i = 0; i < EXPORT_TYPES.length; i++) {
        if (isTypeToken(token, EXPORT_TYPES[i].token)) return EXPORT_TYPES[i].type;
    }
    return null;
}

function namedExportTypeFromToken(token: string | undefined): NamedExportType | null {
    for (let i = 0; i < NAMED_EXPORT_TYPES.length; i++) {
        if (token === NAMED_EXPORT_TYPES[i].token) return NAMED_EXPORT_TYPES[i].type;
    }
    return null;
}

function runExportWithDestination(
    explicitPath: string | undefined,
    task: (ctx: TaskContext, destination: ExportDestination) => Promise<void>
): void {
    runExportTask(async (ctx) => {
        await task(ctx, await resolveExportDestination(ctx, explicitPath));
    });
}

async function exportBatch(
    ctx: TaskContext,
    destination: ExportDestination,
    request: ExportBatchRequest
): Promise<void> {
    const { importJsonPath, rootDir } = destination;
    switch (request.type) {
        case "FUNCTION":
            await exportAllFunctions(ctx, {
                importJsonPath,
                rootDir,
                names: request.names,
                skipExisting: request.skipExisting,
                progress: createExportProgressSink("FUNCTION", importJsonPath),
            });
            return;
        case "EVENT":
            await exportAllEvents(ctx, {
                importJsonPath,
                rootDir,
                names: request.names,
                skipExisting: request.skipExisting,
                progress: createExportProgressSink("EVENT", importJsonPath),
            });
            return;
        case "MENU":
            await exportAllMenus(ctx, {
                importJsonPath,
                rootDir,
                names: request.names,
                skipExisting: request.skipExisting,
                progress: createExportProgressSink("MENU", importJsonPath),
            });
            return;
        case "REGION":
            await exportAllRegions(ctx, {
                importJsonPath,
                rootDir,
                names: request.names,
                skipExisting: request.skipExisting,
                progress: createExportProgressSink("REGION", importJsonPath),
            });
            return;
        case "COMMAND":
            await exportAllCommands(ctx, {
                importJsonPath,
                rootDir,
                names: request.names,
                skipExisting: request.skipExisting,
                progress: createExportProgressSink("COMMAND", importJsonPath),
            });
            return;
        case "NPC":
            await exportAllNpcs(ctx, {
                importJsonPath,
                rootDir,
                entries: request.entries,
                skipExisting: request.skipExisting,
                progress: createExportProgressSink("NPC", importJsonPath),
            });
            return;
        default: {
            const _check: never = request;
            void _check;
        }
    }
}

async function exportExisting(
    ctx: TaskContext,
    destination: ExportDestination
): Promise<void> {
    const { importJsonPath } = destination;
    const functionNames = readFunctionNamesFromImportJson(importJsonPath);
    const eventNames = readEventNamesFromImportJson(importJsonPath);
    const menuNames = readMenuNamesFromImportJson(importJsonPath);
    const regionNames = readRegionNamesFromImportJson(importJsonPath);
    const commandNames = readCommandNamesFromImportJson(importJsonPath);
    const npcEntries = readNpcEntriesFromImportJson(importJsonPath);
    if (
        functionNames.length === 0 &&
        eventNames.length === 0 &&
        menuNames.length === 0 &&
        regionNames.length === 0 &&
        commandNames.length === 0 &&
        npcEntries.length === 0
    ) {
        ctx.displayMessage(
            `&cNo functions[], events[], menus[], regions[], commands[], or npcs[] entries found in ${importJsonPath}`
        );
        return;
    }

    if (functionNames.length > 0) {
        await exportBatch(ctx, destination, { type: "FUNCTION", names: functionNames });
    }
    if (eventNames.length > 0) {
        await exportBatch(ctx, destination, { type: "EVENT", names: eventNames });
    }
    if (menuNames.length > 0) {
        await exportBatch(ctx, destination, { type: "MENU", names: menuNames });
    }
    if (regionNames.length > 0) {
        await exportBatch(ctx, destination, { type: "REGION", names: regionNames });
    }
    if (commandNames.length > 0) {
        await exportBatch(ctx, destination, { type: "COMMAND", names: commandNames });
    }
    if (npcEntries.length > 0) {
        await exportBatch(ctx, destination, { type: "NPC", entries: npcEntries });
    }
}

function runExportTask(task: (ctx: TaskContext) => Promise<void>): void {
    if (isTaskRunning() || TaskManager.hasRunningTasks()) {
        ChatLib.chat("&c[htsw] An export (or another task) is already running - wait for it to finish or cancel it first.");
        return;
    }

    TaskManager.run(async (ctx) => {
        setActiveExportContext(ctx);
        setTaskRunning(true);
        traceRecord("exportTask", { stage: "start" });
        try {
            const purged = resetEventContainers();
            if (purged > 0) {
                ChatLib.chat(`&8[htsw] purged ${purged} leaked event waiter(s) from a prior run.`);
                traceRecord("waiters", { stage: "purged", count: purged });
            }
            await task(ctx);
            traceRecord("exportTask", { stage: "success" });
        } finally {
            clearActiveExportContext(ctx);
            setTaskRunning(false);
        }
    }).catch((err) => {
        setTaskRunning(false);
        traceError("exportTask", err);
        ChatLib.chat(`&cExport failed: ${err}`);
    });
}

function printExportHelp(): void {
    ChatLib.chat(`&7${chatSeparator()}`);
    const title = `&e&lHTSW &fExporter &f&l${VERSION}`;
    ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
    ChatLib.chat("");
    ChatLib.chat("&f/export function <name> [path]");
    ChatLib.chat("&7  Reads a Hypixel function and writes a .htsl + import.json.");
    ChatLib.chat("&7  [path] may be a directory or a specific import.json.");
    ChatLib.chat("&f/export all function [path]");
    ChatLib.chat("&7  Exports every function not already complete in the target path.");
    ChatLib.chat("&f/export resume function [path]");
    ChatLib.chat("&7  Exports only live functions missing from the target import.json/.htsl files.");
    ChatLib.chat("&f/export all event [path]");
    ChatLib.chat("&7  Exports every event not already complete in the target path.");
    ChatLib.chat("&f/export all menu [path]");
    ChatLib.chat("&7  Exports every menu not already complete in the target path.");
    ChatLib.chat("&f/export all region [path]");
    ChatLib.chat("&7  Exports every region not already complete in the target path.");
    ChatLib.chat("&f/export all command [path]");
    ChatLib.chat("&7  Exports every custom command not already complete in the target path.");
    ChatLib.chat("&f/export all npc [path]");
    ChatLib.chat("&7  Exports every NPC's supported code fields not already complete in the target path.");
    ChatLib.chat("&f/export existing [path]");
    ChatLib.chat("&7  Re-exports every function, event, menu, region, command, and NPC listed in the target import.json.");
    ChatLib.chat("&f/export menu <name> [path]");
    ChatLib.chat("&7  Reads a Hypixel menu and writes deduped item .snbt + per-slot .htsl + import.json.");
    ChatLib.chat("&f/export region <name> [path]");
    ChatLib.chat("&7  Reads a Hypixel region and writes bounds + entry/exit .htsl + import.json.");
    ChatLib.chat("&f/export command <name> [path]");
    ChatLib.chat("&7  Reads a Hypixel command and writes actions .htsl + import.json metadata.");
    ChatLib.chat("&f/export npc <name> <x> <y> <z> [path]");
    ChatLib.chat("&7  Reads an existing NPC by position and writes left/right .htsl + import.json metadata.");
    ChatLib.chat("&f/export stop");
    ChatLib.chat("&7  Cancels any running export (or import) task.");
    ChatLib.chat('&7  Quote multi-word names: /export function "Button Blessing" my/path/');
    ChatLib.chat("&7  Default path: ./htsw/projects/<housingUuid>/");
    ChatLib.chat(`&7${chatSeparator()}`);
}

function commandExport(args: string[]): void {
    if (args.length === 0) {
        printExportHelp();
        return;
    }

    const tokens = tokenizeQuoted(args);

    if (tokens[0] === "stop" || tokens[0] === "cancel") {
        TaskManager.cancelAll();
        ChatLib.chat("&c[htsw] cancelling running task...");
        return;
    }

    if ((tokens[0] === "resume" || tokens[0] === "remaining") && isTypeToken(tokens[1], "function")) {
        runExportWithDestination(pathArgument(tokens, 2), async (ctx, destination) => {
            const { importJsonPath } = destination;
            const liveNames = await listAllFunctionNames(ctx);
            const remaining = notYetExportedFunctionNames(importJsonPath, liveNames);

            if (liveNames.length === 0) {
                ctx.displayMessage("&7No functions to export.");
                return;
            }
            if (remaining.names.length === 0) {
                ctx.displayMessage(
                    `&aNothing to resume: ${remaining.skipped} function${remaining.skipped === 1 ? "" : "s"} already exported.`
                );
                ctx.displayMessage(`&7  -> ${importJsonPath}`);
                return;
            }

            ctx.displayMessage(
                `&aResuming function export: ${remaining.names.length} remaining, ${remaining.skipped} already exported${remaining.missingTargets > 0 ? `, ${remaining.missingTargets} missing target file${remaining.missingTargets === 1 ? "" : "s"} repaired` : ""}.`
            );
            await exportBatch(ctx, destination, {
                type: "FUNCTION",
                names: remaining.names,
            });
        });
        return;
    }

    if (tokens[0] === "all") {
        const type = exportTypeFromToken(tokens[1]);
        if (type !== null) {
            runExportWithDestination(pathArgument(tokens, 2), async (ctx, destination) => {
                await exportBatch(ctx, destination, { type, skipExisting: true });
            });
            return;
        }
    }

    if (tokens[0] === "existing") {
        runExportWithDestination(pathArgument(tokens, 1), exportExisting);
        return;
    }

    const namedType = namedExportTypeFromToken(tokens[0]);
    if (namedType !== null) {
        const name = tokens[1];
        if (!name) {
            ChatLib.chat(`&cUsage: /export ${tokens[0]} <name> [path]`);
            ChatLib.chat(`&7  Quote multi-word names: /export ${tokens[0]} "My ${tokens[0]}" my/path/`);
            return;
        }
        runExportWithDestination(pathArgument(tokens, 2), async (ctx, destination) => {
            await exportBatch(ctx, destination, {
                type: namedType,
                names: [name],
            });
        });
        return;
    }

    if (tokens[0] === "npc") {
        const name = tokens[1];
        if (!name || tokens.length < 5) {
            ChatLib.chat("&cUsage: /export npc <name> <x> <y> <z> [path]");
            ChatLib.chat('&7  Quote names with spaces/colors: /export npc "&aShop Keeper" 2 16 70 my/path/');
            return;
        }

        let x: number;
        let y: number;
        let z: number;
        try {
            x = parseIntegerToken(tokens[2], "x");
            y = parseIntegerToken(tokens[3], "y");
            z = parseIntegerToken(tokens[4], "z");
        } catch (error) {
            ChatLib.chat(`&c${error}`);
            ChatLib.chat("&cUsage: /export npc <name> <x> <y> <z> [path]");
            return;
        }

        runExportWithDestination(pathArgument(tokens, 5), async (ctx, destination) => {
            await exportBatch(ctx, destination, {
                type: "NPC",
                entries: [{ name, pos: { x, y, z } }],
            });
        });
        return;
    }

    ChatLib.chat(`&cUnknown subcommand "${tokens[0]}".`);
    printExportHelp();
}

export function registerExportSlashCommand(): void {
    register("command", (...args: string[]) => commandExport(args)).setName("export");
}
