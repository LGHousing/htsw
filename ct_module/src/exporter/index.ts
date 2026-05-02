import { TaskManager } from "../tasks/manager";
import { exportImportable } from "../importables/exports";
import { canonicalSlug, defaultExportRoot } from "./paths";
import { getCurrentHousingUuid } from "../knowledge";
import { chatSeparator } from "../utils/helpers";
import { stripSurroundingQuotes } from "../utils/strings";
import { VERSION } from "htsw";

export { exportImportable } from "../importables/exports";

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
    ChatLib.chat(
        "&7  Reads a Hypixel function and writes a .htsl + import.json."
    );
    ChatLib.chat("&f/export menu <name> [path]");
    ChatLib.chat(
        "&7  Reads a Hypixel menu and writes per-slot .snbt + import.json."
    );
    ChatLib.chat(
        "&7  Default path: ./htsw/exports/<housingUuid>/"
    );
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
        const explicitPath = rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        TaskManager.run(async (ctx) => {
            let rootDir: string;
            if (explicitPath) {
                rootDir = explicitPath.replace(/[\\/]+$/, "");
            } else {
                const uuid = await getCurrentHousingUuid(ctx);
                rootDir = defaultExportRoot(uuid);
            }

            const importJsonPath = `${rootDir}/import.json`;
            const filename = `${canonicalSlug(name)}.htsl`;
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
        const explicitPath = rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        TaskManager.run(async (ctx) => {
            let rootDir: string;
            if (explicitPath) {
                rootDir = explicitPath.replace(/[\\/]+$/, "");
            } else {
                const uuid = await getCurrentHousingUuid(ctx);
                rootDir = defaultExportRoot(uuid);
            }

            const importJsonPath = `${rootDir}/import.json`;

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
    register("command", (...args: string[]) => commandExport(args)).setName(
        "export"
    );
}
