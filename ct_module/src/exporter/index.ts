import { TaskManager } from "../tasks/manager";
import { exportImportable } from "../importables/exports";
import { getCurrentHousingUuid } from "../knowledge";
import {
    defaultExportRoot,
    htslFilenameForFunctionExport,
    readFunctionNamesFromImportJson,
    resolveModuleRelativePath,
} from "./paths";
import { chatSeparator, stripSurroundingQuotes } from "../utils/helpers";
import { beginTraceRun, endTraceRun, setTraceImportable } from "../importer/traceLog";
import { VERSION } from "htsw";

export { exportImportable } from "../importables/exports";

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

/**
 * Re-tokenize CT command args, respecting double-quoted groups. CT's
 * command framework splits the chat line by whitespace, so a quoted
 * arg like `"Button Blessing"` arrives as separate tokens `["Button`
 * and `Blessing"]`. This walks the token list and rejoins anything
 * between a token that opens with `"` and a token that closes with
 * `"` into a single logical arg, with the surrounding quotes stripped.
 *
 * Same rule chat / shell parsers use. Examples:
 *   ['"Button',  'Blessing"', 'path']       → ['Button Blessing', 'path']
 *   ['"single"', 'path']                    → ['single', 'path']
 *   ['plain',    'arg']                     → ['plain', 'arg']
 *   ['"unclosed', 'name', 'forever']         → ['unclosed name forever']  (best-effort: treat unclosed as run-to-end)
 */
function tokenizeQuoted(args: readonly string[]): string[] {
    const out: string[] = [];
    let i = 0;
    while (i < args.length) {
        const arg = args[i];
        // Single-token quoted: `"foo"` — strip both quotes.
        if (arg.length >= 2 && arg.charAt(0) === '"' && arg.charAt(arg.length - 1) === '"') {
            out.push(arg.substring(1, arg.length - 1));
            i++;
            continue;
        }
        // Multi-token quoted: `"foo` ... `bar"`. Collect until a token ends
        // with `"`. If no closing quote is ever found, run to end of args
        // (still strip the leading `"`).
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
    // Resolve under the module's imports/ folder for bare/simple-
    // relative names. Same rule as /import, see resolveModuleRelativePath.
    const path = resolveModuleRelativePath(trimTrailingSlashes(explicitPath));
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
    ChatLib.chat("&f/export all function [path]");
    ChatLib.chat("&7  Exports every function in this housing in menu order.");
    ChatLib.chat("&f/export existing [path]");
    ChatLib.chat("&7  Re-exports every function listed in the target import.json.");
    ChatLib.chat("&f/export menu <name> [path]");
    ChatLib.chat("&7  Reads a Hypixel menu and writes per-slot .snbt + import.json.");
    ChatLib.chat("&f/export stop");
    ChatLib.chat("&7  Cancels any running export (or import) task.");
    ChatLib.chat('&7  Quote multi-word names: /export function "Button Blessing" my/path/');
    ChatLib.chat("&7  Default path: ./config/ChatTriggers/modules/HTSW/imports/<housingUuid>/");
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

    // Re-tokenize so `"multi word"` collapses to one logical arg. CT's
    // command framework splits the chat line by whitespace, so without
    // this `/export function "Button Blessing" path` would arrive as 4
    // tokens with the function half-eaten on either side of the quotes.
    const tokens = tokenizeQuoted(args);

    if (tokens[0] === "stop" || tokens[0] === "cancel") {
        // Cancels EVERY running task, not just exports — same call the
        // GUI's red cancel button uses. Matches existing behavior: if
        // something else is in flight (e.g. a /import) it'd be cancelled
        // too. Acceptable since the user clearly wants out.
        TaskManager.cancelAll();
        ChatLib.chat("&c[htsw] cancelling running task...");
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

            const names = readFunctionNamesFromImportJson(importJsonPath);
            if (names.length === 0) {
                ctx.displayMessage(
                    `&cNo functions[] entries found in ${importJsonPath}`
                );
                return;
            }
            ctx.displayMessage(
                `&aRe-exporting ${names.length} function${names.length === 1 ? "" : "s"} listed in ${importJsonPath}`
            );

            const tracePath = beginTraceRun({
                queueSize: 0,
                sourcePath: importJsonPath,
                trustMode: false,
            });
            let imported = 0;
            let failed = 0;
            try {
                await exportImportable(ctx, {
                    type: "ALL_FUNCTIONS",
                    importJsonPath,
                    rootDir,
                    names,
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

            // Per-function trace tagging happens inside
            // `exportFunctionWithSharedState` via `makeDiffSink`, so the
            // batch-level run begins untagged. We pass `queueSize: 0`
            // because we don't know the count until we open the function
            // list — the per-importable events still get emitted as each
            // function's read kicks off.
            const tracePath = beginTraceRun({
                queueSize: 0,
                sourcePath: importJsonPath,
                trustMode: false,
            });

            let imported = 0;
            let failed = 0;
            try {
                await exportImportable(ctx, {
                    type: "ALL_FUNCTIONS",
                    importJsonPath,
                    rootDir,
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

            const filename = htslFilenameForFunctionExport(importJsonPath, name);
            const htslPath = `${rootDir}/${filename}`;
            const htslReference = filename;

            ctx.displayMessage(`&aExporting function '${name}'...`);

            // Open a trace run so detailed JSON events land in
            // ./htsw/imports-trace/<timestamp>.json when /htsw trace is
            // on. The "imports-trace" filename reflects the original
            // import-side feature but the same machinery now captures
            // export reads too — both go through readActionList.
            const tracePath = beginTraceRun({
                queueSize: 1,
                sourcePath: htslPath,
                trustMode: false,
            });
            setTraceImportable(`FUNCTION:${name}`, {
                type: "FUNCTION",
                identity: name,
                sourcePath: htslPath,
            });

            let imported = 0;
            let failed = 0;
            try {
                await exportImportable(ctx, {
                    type: "FUNCTION",
                    name,
                    importJsonPath,
                    htslPath,
                    htslReference,
                    rootDir,
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

            const tracePath = beginTraceRun({
                queueSize: 1,
                sourcePath: rootDir,
                trustMode: false,
            });
            setTraceImportable(`MENU:${name}`, {
                type: "MENU",
                identity: name,
                sourcePath: rootDir,
            });

            let imported = 0;
            let failed = 0;
            try {
                await exportImportable(ctx, {
                    type: "MENU",
                    name,
                    importJsonPath,
                    rootDir,
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

    ChatLib.chat(`&cUnknown subcommand "${tokens[0]}".`);
    printExportHelp();
}

/**
 * Wire up `/export` with ChatTriggers. Called once during module init.
 */
export function registerExportCommands(): void {
    register("command", (...args: string[]) => commandExport(args)).setName("export");
}
