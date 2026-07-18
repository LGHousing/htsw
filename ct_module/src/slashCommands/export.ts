import { cancelActiveTask } from "../tasks/activeTask";
import { listAllFunctionNames } from "../importables/functions/listFunctions";
import {
    exportBatch,
    exportExisting,
    notYetExportedFunctionNames,
} from "./exportBatch";
import {
    exportTypeFromToken,
    isTypeToken,
    namedExportTypeFromToken,
    parseIntegerToken,
    pathArgument,
    tokenizeQuoted,
} from "./exportArgs";
import { printExportHelp } from "./exportHelp";
import { runExportWithDestination } from "./exportTask";
import {
    exportDeclaredItemActions,
    exportHeldItem,
} from "../importables/items/export";
import { createExportProgressSink } from "../gui/export/progressSink";

export function commandExport(args: string[]): void {
    if (args.length === 0) {
        printExportHelp();
        return;
    }

    const tokens = tokenizeQuoted(args);

    if (tokens[0] === "stop" || tokens[0] === "cancel") {
        if (cancelActiveTask()) {
            ChatLib.chat("&c[htsw] cancelling running task...");
        } else {
            ChatLib.chat("&7[htsw] No import/export task is running.");
        }
        return;
    }

    if (tokens[0] === "item" || tokens[0] === "itemactions") {
        const read = tokens[0] === "item" ? exportHeldItem : exportDeclaredItemActions;
        runExportWithDestination(pathArgument(tokens, 1), async (ctx, destination) => {
            await read(ctx, {
                importJsonPath: destination.importJsonPath,
                rootDir: destination.rootDir,
                projectItems: destination.projectItems,
                progress: createExportProgressSink("ITEM", destination.importJsonPath),
            });
        });
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
