import { TaskManager } from "../tasks/manager";
import { exportImportable } from "../importables/exports";
import { exportAllFunctions } from "../importables/functions/exportAll";
import { exportAllEvents } from "../importables/events/exportAll";
import { exportAllMenus } from "../importables/menus/exportAll";
import { createExportProgressSink } from "../gui/right-panel/import-tab/exportProgress";
import { getCurrentHousingUuid } from "../importCache";
import {
    defaultExportRoot,
    htslTargetForFunctionExport,
    readEventNamesFromImportJson,
    readFunctionNamesFromImportJson,
    resolveModuleRelativePath,
} from "./paths";
import { chatSeparator, stripSurroundingQuotes } from "../utils/helpers";
import { VERSION } from "htsw";
import {
    beginTraceRun,
    endTraceRun,
    setTraceImportable,
} from "./traceLog";


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

function printExportHelp(): void {
    ChatLib.chat(`&7${chatSeparator()}`);
    const title = `&e&lHTSW &fExporter &f&l${VERSION}`;
    ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
    ChatLib.chat("");
    ChatLib.chat("&f/export function <name> [path]");
    ChatLib.chat("&7  Reads a Hypixel function and writes a .htsl + import.json.");
    ChatLib.chat("&7  [path] may be a directory or a specific import.json.");
    ChatLib.chat("&f/export all function [path]");
    ChatLib.chat("&7  Exports every function in this housing in menu order.");
    ChatLib.chat("&f/export all event [path]");
    ChatLib.chat("&7  Exports every event in this housing's /eventactions menu.");
    ChatLib.chat("&f/export all menu [path]");
    ChatLib.chat("&7  Exports every menu in this housing's /menus list.");
    ChatLib.chat("&f/export existing [path]");
    ChatLib.chat("&7  Re-exports every function and event listed in the target import.json.");
    ChatLib.chat("&f/export menu <name> [path]");
    ChatLib.chat("&7  Reads a Hypixel menu and writes deduped item .snbt + per-slot .htsl + import.json.");
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

    if (tokens[0] === "all" && tokens[1] === "function") {
        const pathParts = tokens.slice(2);
        const rawPath = pathParts.length > 0 ? pathParts.join(" ") : "";
        const explicitPath =
            rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        TaskManager.run(async (ctx) => {
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

            const tracePath = beginTraceRun({
                queueSize: 0,
                sourcePath: importJsonPath,
                trustMode: false,
            });

            let imported = 0;
            let failed = 0;
            try {
                await exportAllFunctions(ctx, {
                    importJsonPath,
                    rootDir,
                    progress: createExportProgressSink("FUNCTION", importJsonPath),
                });
                imported = 1;
            } catch (err) {
                failed = 1;
                throw err;
            } finally {
                setTraceImportable(null);
                const written = endTraceRun({ imported, skipped: 0, failed });
                if (written !== null && tracePath !== null) {
                    ctx.displayMessage(`&7[trace] &fwrote ${written}`);
                }
            }
        }).catch((err) => {
            ChatLib.chat(`&cExport failed: ${err}`);
        });
        return;
    }

    if (tokens[0] === "all" && tokens[1] === "event") {
        const pathParts = tokens.slice(2);
        const rawPath = pathParts.length > 0 ? pathParts.join(" ") : "";
        const explicitPath =
            rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        TaskManager.run(async (ctx) => {
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

            const tracePath = beginTraceRun({
                queueSize: 0,
                sourcePath: importJsonPath,
                trustMode: false,
            });

            let imported = 0;
            let failed = 0;
            try {
                await exportAllEvents(ctx, {
                    importJsonPath,
                    rootDir,
                    progress: createExportProgressSink("EVENT", importJsonPath),
                });
                imported = 1;
            } catch (err) {
                failed = 1;
                throw err;
            } finally {
                setTraceImportable(null);
                const written = endTraceRun({ imported, skipped: 0, failed });
                if (written !== null && tracePath !== null) {
                    ctx.displayMessage(`&7[trace] &fwrote ${written}`);
                }
            }
        }).catch((err) => {
            ChatLib.chat(`&cExport failed: ${err}`);
        });
        return;
    }

    if (tokens[0] === "all" && tokens[1] === "menu") {
        const pathParts = tokens.slice(2);
        const rawPath = pathParts.length > 0 ? pathParts.join(" ") : "";
        const explicitPath =
            rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        TaskManager.run(async (ctx) => {
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

            const tracePath = beginTraceRun({
                queueSize: 0,
                sourcePath: importJsonPath,
                trustMode: false,
            });

            let imported = 0;
            let failed = 0;
            try {
                const result = await exportAllMenus(ctx, {
                    importJsonPath,
                    rootDir,
                    progress: createExportProgressSink("MENU", importJsonPath),
                });
                imported = result.succeeded;
                failed = result.failed;
            } catch (err) {
                if (failed === 0) failed = 1;
                throw err;
            } finally {
                setTraceImportable(null);
                const written = endTraceRun({ imported, skipped: 0, failed });
                if (written !== null && tracePath !== null) {
                    ctx.displayMessage(`&7[trace] &fwrote ${written}`);
                }
            }
        }).catch((err) => {
            ChatLib.chat(`&cExport failed: ${err}`);
        });
        return;
    }

    if (tokens[0] === "existing") {
        const pathParts = tokens.slice(1);
        const rawPath = pathParts.length > 0 ? pathParts.join(" ") : "";
        const explicitPath =
            rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        TaskManager.run(async (ctx) => {
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
            if (functionNames.length === 0 && eventNames.length === 0) {
                ctx.displayMessage(
                    `&cNo functions[] or events[] entries found in ${importJsonPath}`
                );
                return;
            }

            const tracePath = beginTraceRun({
                queueSize: 0,
                sourcePath: importJsonPath,
                trustMode: false,
            });

            let imported = 0;
            let failed = 0;
            try {
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
                imported = 1;
            } catch (err) {
                failed = 1;
                throw err;
            } finally {
                setTraceImportable(null);
                const written = endTraceRun({ imported, skipped: 0, failed });
                if (written !== null && tracePath !== null) {
                    ctx.displayMessage(`&7[trace] &fwrote ${written}`);
                }
            }
        }).catch((err) => {
            ChatLib.chat(`&cExport failed: ${err}`);
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

        TaskManager.run(async (ctx) => {
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

            const target = htslTargetForFunctionExport(importJsonPath, name);

            ctx.displayMessage(`&aExporting function '${name}'...`);
            await exportImportable(ctx, {
                type: "FUNCTION",
                name,
                importJsonPath,
                declaringJsonPath: target.importJsonPath,
                htslPath: target.htslPath,
                htslReference: target.htslReference,
                rootDir,
            });
        }).catch((err) => {
            ChatLib.chat(`&cExport failed: ${err}`);
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

        TaskManager.run(async (ctx) => {
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

            ctx.displayMessage(`&aExporting menu '${name}'...`);
            await exportImportable(ctx, {
                type: "MENU",
                name,
                importJsonPath,
                rootDir,
            });
        }).catch((err) => {
            ChatLib.chat(`&cExport failed: ${err}`);
        });
        return;
    }

    ChatLib.chat(`&cUnknown subcommand "${tokens[0]}".`);
    printExportHelp();
}

export function registerExportCommands(): void {
    register("command", (...args: string[]) => commandExport(args)).setName("export");
}
