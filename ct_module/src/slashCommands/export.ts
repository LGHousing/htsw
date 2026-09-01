import {
    exportTypeFromToken,
    isTypeToken,
    namedExportTypeFromToken,
    parseIntegerToken,
    pathArgument,
    tokenizeQuoted,
} from "./exportArgs";
import { printExportHelp } from "./exportHelp";
import { captureOpenChest, exportCapturedChest } from "../importables/menus/exportChest";
import { getHousingUuid } from "../gui/state";
import { queuedExportDestination } from "./exportDestination";
import {
    addQueueRow,
    makeBulkQueueRow,
    makeImportableQueueRow,
    type QueueAddResult,
    type QueueRow,
} from "../gui/right-panel/import-tab/queue";
import { autoRunQueueChanged } from "../gui/autoRun";
import { parseImportJsonCurrentBlocking } from "../gui/parsing/parses";
import { importableIdentity } from "../importables/identity";
import { pauseQueue } from "../gui/right-panel/import-tab/queueRunner";
import { readProjectExportDestination } from "../importables/export/projectDestination";
import { parentDirOf } from "../project/paths";

function rowAdded(result: QueueAddResult): boolean {
    return result.kind === "added" || result.kind === "alsoQueuedOtherDirection";
}

function queueExportRow(row: QueueRow, label: string): void {
    const result = addQueueRow(row);
    if (!rowAdded(result)) {
        ChatLib.chat(`&e[htsw] ${result.message}`);
        return;
    }
    ChatLib.chat(`&a[htsw] Queued ${label}`);
    autoRunQueueChanged();
}

function exportTarget(explicitPath: string | undefined): {
    house: string;
    path: string;
} | null {
    const house = getHousingUuid();
    if (house === null) {
        ChatLib.chat("&c[htsw] Enter a Housing house first.");
        return null;
    }
    return {
        house,
        path: queuedExportDestination(explicitPath, house).importJsonPath,
    };
}

export function commandExport(args: string[]): void {
    if (args.length === 0) {
        printExportHelp();
        return;
    }

    const tokens = tokenizeQuoted(args);

    if (tokens[0] === "stop" || tokens[0] === "cancel") {
        if (pauseQueue() !== null) {
            ChatLib.chat("&c[htsw] cancelling running queue session...");
        } else {
            ChatLib.chat("&7[htsw] No import/export task is running.");
        }
        return;
    }

    if (tokens[0] === "item") {
        const target = exportTarget(pathArgument(tokens, 1));
        if (target === null) return;
        queueExportRow(
            makeImportableQueueRow({
                op: "export",
                house: target.house,
                path: target.path,
                type: "ITEM",
                identity: "held item",
                label: "Held item",
            }),
            "held-item export"
        );
        return;
    }

    if (
        (tokens[0] === "resume" || tokens[0] === "remaining") &&
        isTypeToken(tokens[1], "function")
    ) {
        const target = exportTarget(pathArgument(tokens, 2));
        if (target === null) return;
        queueExportRow(
            makeBulkQueueRow({
                op: "export",
                house: target.house,
                path: target.path,
                scope: { kind: "houseType", type: "FUNCTION" },
                filter: "new",
                label: "Export new functions",
            }),
            "remaining function export"
        );
        return;
    }

    if (tokens[0] === "all") {
        const type = exportTypeFromToken(tokens[1]);
        if (type !== null) {
            const target = exportTarget(pathArgument(tokens, 2));
            if (target === null) return;
            queueExportRow(
                makeBulkQueueRow({
                    op: "export",
                    house: target.house,
                    path: target.path,
                    scope: { kind: "houseType", type },
                    filter: "new",
                    label: `Export new ${type.toLowerCase()}s`,
                }),
                `${type} export`
            );
            return;
        }
    }

    if (tokens[0] === "existing") {
        const target = exportTarget(pathArgument(tokens, 1));
        if (target === null) return;
        const parsed = parseImportJsonCurrentBlocking(target.path);
        if (parsed.parsed === null) {
            ChatLib.chat(
                `&c[htsw] Could not parse ${target.path}: ${parsed.error ?? "parse failed"}`
            );
            return;
        }
        let added = 0;
        for (const imp of parsed.parsed.value) {
            if (imp.type === "ITEM") continue;
            const result = addQueueRow(
                makeImportableQueueRow({
                    op: "export",
                    house: target.house,
                    path: target.path,
                    type: imp.type,
                    identity: importableIdentity(imp),
                    label: imp.type === "EVENT" ? imp.event : imp.name,
                })
            );
            if (rowAdded(result)) added++;
        }
        ChatLib.chat(
            `&a[htsw] Queued ${added} declared importable export${added === 1 ? "" : "s"}`
        );
        if (added > 0) autoRunQueueChanged();
        return;
    }

    if (tokens[0] === "chest") {
        const captured = captureOpenChest();
        if (captured === null) {
            ChatLib.chat(
                "&e[htsw] Open a chest first, then run this command from the HTSW overlay chat (T) while the chest is open."
            );
            return;
        }
        if (captured.slots.length === 0) {
            ChatLib.chat("&e[htsw] The open chest has no items to export.");
            return;
        }
        const name = tokens[1];
        if (!name) {
            ChatLib.chat("&cUsage: /export chest <name> [path]");
            ChatLib.chat('&7  Quote multi-word names: /export chest "My Menu" my/path/');
            return;
        }
        const target = exportTarget(pathArgument(tokens, 2));
        if (target === null) return;
        const destination = readProjectExportDestination({
            rootDir: parentDirOf(target.path),
            importJsonPath: target.path,
        });
        void exportCapturedChest(
            { displayMessage: (message) => ChatLib.chat(message) },
            captured,
            { name, ...destination }
        ).catch((error: unknown) => {
            ChatLib.chat(`&c[htsw] Chest export failed: ${String(error)}`);
        });
        return;
    }

    const namedType = namedExportTypeFromToken(tokens[0]);
    if (namedType !== null) {
        const name = tokens[1];
        if (!name) {
            ChatLib.chat(`&cUsage: /export ${tokens[0]} <name> [path]`);
            ChatLib.chat(
                `&7  Quote multi-word names: /export ${tokens[0]} "My ${tokens[0]}" my/path/`
            );
            return;
        }
        const target = exportTarget(pathArgument(tokens, 2));
        if (target === null) return;
        queueExportRow(
            makeImportableQueueRow({
                op: "export",
                house: target.house,
                path: target.path,
                type: namedType,
                identity: name,
                label: name,
            }),
            `${namedType} ${name}`
        );
        return;
    }

    if (tokens[0] === "npc") {
        const name = tokens[1];
        if (!name || tokens.length < 5) {
            ChatLib.chat("&cUsage: /export npc <name> <x> <y> <z> [path]");
            ChatLib.chat(
                '&7  Quote names with spaces/colors: /export npc "&aShop Keeper" 2 16 70 my/path/'
            );
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
            ChatLib.chat(`&c${String(error)}`);
            ChatLib.chat("&cUsage: /export npc <name> <x> <y> <z> [path]");
            return;
        }

        const target = exportTarget(pathArgument(tokens, 5));
        if (target === null) return;
        queueExportRow(
            makeImportableQueueRow({
                op: "export",
                house: target.house,
                path: target.path,
                type: "NPC",
                identity: `${x},${y},${z}`,
                label: name,
            }),
            `NPC ${name}`
        );
        return;
    }

    ChatLib.chat(`&cUnknown subcommand "${tokens[0]}".`);
    printExportHelp();
}

export function registerExportSlashCommand(): void {
    register("command", (...args: string[]) => commandExport(args)).setName("export");
}
