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
import { isImportRunning, setImportRunning } from "../housingSync/runtimeState";
import { resetEventContainers } from "../tasks/specifics/waitFor";
import { getCurrentHousingUuid } from "../importCache";
import { traceError, traceRecord } from "../housingSync/trace/importTrace";
import { clearActiveExportContext, setActiveExportContext } from "./activeExport";
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
): Promise<{ rootDir: string; importJsonPath: string }> {
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

function runExportTask(task: (ctx: TaskContext) => Promise<void>): void {
    if (isImportRunning() || TaskManager.hasRunningTasks()) {
        ChatLib.chat("&c[htsw] An export (or another task) is already running - wait for it to finish or cancel it first.");
        return;
    }

    TaskManager.run(async (ctx) => {
        setActiveExportContext(ctx);
        setImportRunning(true);
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
            setImportRunning(false);
        }
    }).catch((err) => {
        setImportRunning(false);
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
        const pathParts = tokens.slice(2);
        const rawPath = pathParts.length > 0 ? pathParts.join(" ") : "";
        const explicitPath =
            rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        runExportTask(async (ctx) => {
            const { rootDir, importJsonPath } = await resolveExportDestination(ctx, explicitPath);
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
            await exportAllFunctions(ctx, {
                importJsonPath,
                rootDir,
                names: remaining.names,
                progress: createExportProgressSink("FUNCTION", importJsonPath),
            });
        });
        return;
    }

    if (tokens[0] === "all" && isTypeToken(tokens[1], "function")) {
        const pathParts = tokens.slice(2);
        const rawPath = pathParts.length > 0 ? pathParts.join(" ") : "";
        const explicitPath =
            rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        runExportTask(async (ctx) => {
            let rootDir: string;
            let importJsonPath: string;
            const explicitDestination = exportDestination(explicitPath);
            if (explicitDestination !== null) {
                rootDir = explicitDestination.rootDir;
                importJsonPath = explicitDestination.importJsonPath;
            } else {
                const uuid = await getCurrentHousingUuid(ctx);
                rootDir = defaultExportRoot(uuid);
                importJsonPath = `${rootDir}/import.json`;
            }

            await exportAllFunctions(ctx, {
                importJsonPath,
                rootDir,
                skipExisting: true,
                progress: createExportProgressSink("FUNCTION", importJsonPath),
            });
        });
        return;
    }

    if (tokens[0] === "all" && isTypeToken(tokens[1], "event")) {
        const pathParts = tokens.slice(2);
        const rawPath = pathParts.length > 0 ? pathParts.join(" ") : "";
        const explicitPath =
            rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        runExportTask(async (ctx) => {
            let rootDir: string;
            let importJsonPath: string;
            const explicitDestination = exportDestination(explicitPath);
            if (explicitDestination !== null) {
                rootDir = explicitDestination.rootDir;
                importJsonPath = explicitDestination.importJsonPath;
            } else {
                const uuid = await getCurrentHousingUuid(ctx);
                rootDir = defaultExportRoot(uuid);
                importJsonPath = `${rootDir}/import.json`;
            }

            await exportAllEvents(ctx, {
                importJsonPath,
                rootDir,
                skipExisting: true,
                progress: createExportProgressSink("EVENT", importJsonPath),
            });
        });
        return;
    }

    if (tokens[0] === "all" && isTypeToken(tokens[1], "menu")) {
        const pathParts = tokens.slice(2);
        const rawPath = pathParts.length > 0 ? pathParts.join(" ") : "";
        const explicitPath =
            rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        runExportTask(async (ctx) => {
            let rootDir: string;
            let importJsonPath: string;
            const explicitDestination = exportDestination(explicitPath);
            if (explicitDestination !== null) {
                rootDir = explicitDestination.rootDir;
                importJsonPath = explicitDestination.importJsonPath;
            } else {
                const uuid = await getCurrentHousingUuid(ctx);
                rootDir = defaultExportRoot(uuid);
                importJsonPath = `${rootDir}/import.json`;
            }

            await exportAllMenus(ctx, {
                importJsonPath,
                rootDir,
                skipExisting: true,
                progress: createExportProgressSink("MENU", importJsonPath),
            });
        });
        return;
    }

    if (tokens[0] === "all" && isTypeToken(tokens[1], "region")) {
        const pathParts = tokens.slice(2);
        const rawPath = pathParts.length > 0 ? pathParts.join(" ") : "";
        const explicitPath =
            rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        runExportTask(async (ctx) => {
            let rootDir: string;
            let importJsonPath: string;
            const explicitDestination = exportDestination(explicitPath);
            if (explicitDestination !== null) {
                rootDir = explicitDestination.rootDir;
                importJsonPath = explicitDestination.importJsonPath;
            } else {
                const uuid = await getCurrentHousingUuid(ctx);
                rootDir = defaultExportRoot(uuid);
                importJsonPath = `${rootDir}/import.json`;
            }

            await exportAllRegions(ctx, {
                importJsonPath,
                rootDir,
                skipExisting: true,
                progress: createExportProgressSink("REGION", importJsonPath),
            });
        });
        return;
    }

    if (tokens[0] === "all" && isTypeToken(tokens[1], "command")) {
        const pathParts = tokens.slice(2);
        const rawPath = pathParts.length > 0 ? pathParts.join(" ") : "";
        const explicitPath =
            rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        runExportTask(async (ctx) => {
            const { rootDir, importJsonPath } = await resolveExportDestination(ctx, explicitPath);

            await exportAllCommands(ctx, {
                importJsonPath,
                rootDir,
                skipExisting: true,
                progress: createExportProgressSink("COMMAND", importJsonPath),
            });
        });
        return;
    }

    if (tokens[0] === "all" && isTypeToken(tokens[1], "npc")) {
        const pathParts = tokens.slice(2);
        const rawPath = pathParts.length > 0 ? pathParts.join(" ") : "";
        const explicitPath =
            rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        runExportTask(async (ctx) => {
            const { rootDir, importJsonPath } = await resolveExportDestination(ctx, explicitPath);

            await exportAllNpcs(ctx, {
                importJsonPath,
                rootDir,
                skipExisting: true,
                progress: createExportProgressSink("NPC", importJsonPath),
            });
        });
        return;
    }

    if (tokens[0] === "existing") {
        const pathParts = tokens.slice(1);
        const rawPath = pathParts.length > 0 ? pathParts.join(" ") : "";
        const explicitPath =
            rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        runExportTask(async (ctx) => {
            let rootDir: string;
            let importJsonPath: string;
            const explicitDestination = exportDestination(explicitPath);
            if (explicitDestination !== null) {
                rootDir = explicitDestination.rootDir;
                importJsonPath = explicitDestination.importJsonPath;
            } else {
                const uuid = await getCurrentHousingUuid(ctx);
                rootDir = defaultExportRoot(uuid);
                importJsonPath = `${rootDir}/import.json`;
            }

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
                await exportAllFunctions(ctx, {
                    importJsonPath,
                    rootDir,
                    names: functionNames,
                    progress: createExportProgressSink("FUNCTION", importJsonPath),
                });
            }
            if (eventNames.length > 0) {
                await exportAllEvents(ctx, {
                    importJsonPath,
                    rootDir,
                    names: eventNames,
                    progress: createExportProgressSink("EVENT", importJsonPath),
                });
            }
            if (menuNames.length > 0) {
                await exportAllMenus(ctx, {
                    importJsonPath,
                    rootDir,
                    names: menuNames,
                    progress: createExportProgressSink("MENU", importJsonPath),
                });
            }
            if (regionNames.length > 0) {
                await exportAllRegions(ctx, {
                    importJsonPath,
                    rootDir,
                    names: regionNames,
                    progress: createExportProgressSink("REGION", importJsonPath),
                });
            }
            if (commandNames.length > 0) {
                await exportAllCommands(ctx, {
                    importJsonPath,
                    rootDir,
                    names: commandNames,
                    progress: createExportProgressSink("COMMAND", importJsonPath),
                });
            }
            if (npcEntries.length > 0) {
                await exportAllNpcs(ctx, {
                    importJsonPath,
                    rootDir,
                    entries: npcEntries,
                    progress: createExportProgressSink("NPC", importJsonPath),
                });
            }
        });
        return;
    }

    if (tokens[0] === "function") {
        const name = tokens[1];
        if (!name) {
            ChatLib.chat("&cUsage: /export function <name> [path]");
            ChatLib.chat('&7  Quote multi-word names: /export function "Button Blessing" my/path/');
            return;
        }
        const pathParts = tokens.slice(2);
        const rawPath = pathParts.length > 0 ? pathParts.join(" ") : "";
        const explicitPath =
            rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        runExportTask(async (ctx) => {
            let rootDir: string;
            let importJsonPath: string;
            const explicitDestination = exportDestination(explicitPath);
            if (explicitDestination !== null) {
                rootDir = explicitDestination.rootDir;
                importJsonPath = explicitDestination.importJsonPath;
            } else {
                const uuid = await getCurrentHousingUuid(ctx);
                rootDir = defaultExportRoot(uuid);
                importJsonPath = `${rootDir}/import.json`;
            }

            await exportAllFunctions(ctx, {
                importJsonPath,
                rootDir,
                names: [name],
                progress: createExportProgressSink("FUNCTION", importJsonPath),
            });
        });
        return;
    }

    if (tokens[0] === "menu") {
        const name = tokens[1];
        if (!name) {
            ChatLib.chat("&cUsage: /export menu <name> [path]");
            ChatLib.chat('&7  Quote multi-word names: /export menu "My Shop" my/path/');
            return;
        }
        const pathParts = tokens.slice(2);
        const rawPath = pathParts.length > 0 ? pathParts.join(" ") : "";
        const explicitPath =
            rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        runExportTask(async (ctx) => {
            let rootDir: string;
            let importJsonPath: string;
            const explicitDestination = exportDestination(explicitPath);
            if (explicitDestination !== null) {
                rootDir = explicitDestination.rootDir;
                importJsonPath = explicitDestination.importJsonPath;
            } else {
                const uuid = await getCurrentHousingUuid(ctx);
                rootDir = defaultExportRoot(uuid);
                importJsonPath = `${rootDir}/import.json`;
            }

            await exportAllMenus(ctx, {
                importJsonPath,
                rootDir,
                names: [name],
                progress: createExportProgressSink("MENU", importJsonPath),
            });
        });
        return;
    }

    if (tokens[0] === "region") {
        const name = tokens[1];
        if (!name) {
            ChatLib.chat("&cUsage: /export region <name> [path]");
            ChatLib.chat('&7  Quote multi-word names: /export region "My Region" my/path/');
            return;
        }
        const pathParts = tokens.slice(2);
        const rawPath = pathParts.length > 0 ? pathParts.join(" ") : "";
        const explicitPath =
            rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        runExportTask(async (ctx) => {
            let rootDir: string;
            let importJsonPath: string;
            const explicitDestination = exportDestination(explicitPath);
            if (explicitDestination !== null) {
                rootDir = explicitDestination.rootDir;
                importJsonPath = explicitDestination.importJsonPath;
            } else {
                const uuid = await getCurrentHousingUuid(ctx);
                rootDir = defaultExportRoot(uuid);
                importJsonPath = `${rootDir}/import.json`;
            }

            await exportAllRegions(ctx, {
                importJsonPath,
                rootDir,
                names: [name],
                progress: createExportProgressSink("REGION", importJsonPath),
            });
        });
        return;
    }

    if (tokens[0] === "command") {
        const name = tokens[1];
        if (!name) {
            ChatLib.chat("&cUsage: /export command <name> [path]");
            ChatLib.chat('&7  Quote multi-word names: /export command "my command" my/path/');
            return;
        }
        const pathParts = tokens.slice(2);
        const rawPath = pathParts.length > 0 ? pathParts.join(" ") : "";
        const explicitPath =
            rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        runExportTask(async (ctx) => {
            const { rootDir, importJsonPath } = await resolveExportDestination(ctx, explicitPath);

            await exportAllCommands(ctx, {
                importJsonPath,
                rootDir,
                names: [name],
                progress: createExportProgressSink("COMMAND", importJsonPath),
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

        const pathParts = tokens.slice(5);
        const rawPath = pathParts.length > 0 ? pathParts.join(" ") : "";
        const explicitPath =
            rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        runExportTask(async (ctx) => {
            const { rootDir, importJsonPath } = await resolveExportDestination(ctx, explicitPath);

            await exportAllNpcs(ctx, {
                importJsonPath,
                rootDir,
                entries: [{ name, pos: { x, y, z } }],
                progress: createExportProgressSink("NPC", importJsonPath),
            });
        });
        return;
    }

    ChatLib.chat(`&cUnknown subcommand "${tokens[0]}".`);
    printExportHelp();
}

export function registerExportCommands(): void {
    register("command", (...args: string[]) => commandExport(args)).setName("export");
}
