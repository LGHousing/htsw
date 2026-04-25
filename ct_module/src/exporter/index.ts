import { TaskManager } from "../tasks/manager";
import { exportImportable } from "./importables";
import { canonicalSlug, defaultExportRoot } from "./paths";
import { getCurrentHousingUuid } from "../knowledge";
import { chatSeparator } from "../utils/helpers";
import { VERSION } from "htsw";

export { exportImportable } from "./importables";

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
    ChatLib.chat(
        "&7  Default path: ./htsw/exports/<housingUuid>/"
    );
    ChatLib.chat(`&7${chatSeparator()}`);
}

function stripSurroundingQuotes(s: string): string {
    if (s.length >= 2 && s.charAt(0) === "\"" && s.charAt(s.length - 1) === "\"") {
        return s.slice(1, s.length - 1);
    }
    return s;
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
        // Anything past `function <name>` is the destination path. Re-join
        // with spaces in case the user's path contained one, and strip a
        // single pair of surrounding quotes — same UX as /import.
        const pathParts = args.slice(2);
        const rawPath = pathParts.length > 0 ? pathParts.join(" ") : "";
        const explicitPath = rawPath.length > 0 ? stripSurroundingQuotes(rawPath) : undefined;

        TaskManager.run(async (ctx) => {
            // Resolve the destination directory. Default = a per-housing
            // tree under ./htsw/exports so multiple housings stay isolated.
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
            // Reference is relative to the import.json directory, so just
            // the filename — Importer's resolver joins paths against the
            // import.json's parent.
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
