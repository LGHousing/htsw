import { TaskManager } from "../tasks/manager";
import { exportImportable } from "../importables/exports";
import { getCurrentHousingUuid } from "../knowledge";
import { htslFilenameForFunctionExport } from "./paths";
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

function exportDestination(
    explicitPath: string | undefined
): { rootDir: string; importJsonPath: string } | null {
    if (explicitPath === undefined) return null;
    const path = trimTrailingSlashes(explicitPath);
    if (endsWithIgnoreCase(path, ".json")) {
        return { rootDir: dirname(path), importJsonPath: normalizeSlashes(path) };
    }
    const rootDir = normalizeSlashes(path);
    return { rootDir, importJsonPath: `${rootDir}/import.json` };
}

/**
 * Print a short usage block to chat. Mirrors the `/import` and
 * `/simulator` command help blocks for consistency.
 */
function printExportHelp(): void {
    ChatLib.chat(`&7${chatSeparator()}`);
    const title = `&e&lHTSW &fExporter &f&l${VERSION}`;
    ChatLib.chat(`${ChatLib.getCenteredText(title)}`);
    ChatLib.chat("");
    ChatLib.chat("&f/export function <name> [path]");
    ChatLib.chat("&7  Reads a Hypixel function and writes a .htsl + import.json.");
    ChatLib.chat("&7  [path] may be a directory or a specific import.json.");
    ChatLib.chat("&f/export menu <name> [path]");
    ChatLib.chat("&7  Reads a Hypixel menu and writes per-slot .snbt + import.json.");
    ChatLib.chat("&7  Default path: ./htsw/exports/<housingUuid>/");
    ChatLib.chat(`&7${chatSeparator()}`);
}

/**
 * Top-level dispatcher for `/export <subcommand>`. v1 only handles
 * `function <name> [path]`.
 */
function commandExport(args: string[]): void {
    if (args.length === 0) {
        printExportHelp();
        return;
    }

    if (args[0] === "function") {
        const name = args[1];
        if (!name) {
            ChatLib.chat("&cUsage: /export function <name> [path]");
            return;
        }
        const pathParts = args.slice(2);
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
                rootDir = `./htsw/exports/${uuid}`;
                importJsonPath = `${rootDir}/import.json`;
            }

            const filename = htslFilenameForFunctionExport(importJsonPath, name);
            const htslPath = `${rootDir}/${filename}`;
            const htslReference = filename;

            ctx.displayMessage(`&aExporting function '${name}'...`);
            await exportImportable(ctx, {
                type: "FUNCTION",
                name,
                importJsonPath,
                htslPath,
                htslReference,
            });
        }).catch((err) => {
            ChatLib.chat(`&cExport failed: ${err}`);
        });
        return;
    }

    if (args[0] === "menu") {
        const name = args[1];
        if (!name) {
            ChatLib.chat("&cUsage: /export menu <name> [path]");
            return;
        }
        const pathParts = args.slice(2);
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
                rootDir = `./htsw/exports/${uuid}`;
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

    ChatLib.chat(`&cUnknown subcommand "${args[0]}".`);
    printExportHelp();
}

/**
 * Wire up `/export` with ChatTriggers. Called once during module init.
 */
export function registerExportCommands(): void {
    register("command", (...args: string[]) => commandExport(args)).setName("export");
}
