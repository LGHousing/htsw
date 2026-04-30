import {
    Diagnostic,
    SourceMap,
    parseImportablesResult,
} from "htsw";
import type { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import { TaskManager } from "../tasks/manager";
import { FileSystemFileLoader } from "../utils/files";
import { chatSeparator } from "../utils/helpers";
import { stripSurroundingQuotes } from "../utils/strings";
import {
    getCurrentHousingUuid,
    importableHash,
    importableIdentity,
    readKnowledge,
    deleteKnowledge,
} from ".";
import { printDiagnostic, printDiagnostics } from "../tui/diagnostics";

const IMPORTABLE_TYPES: readonly Importable["type"][] = [
    "FUNCTION",
    "EVENT",
    "REGION",
    "ITEM",
    "MENU",
    "NPC",
];

export function commandKnowledge(args: string[]): void {
    const subcommand = args[0];
    if (subcommand === "status") {
        knowledgeStatus(args.slice(1));
        return;
    }
    if (subcommand === "inspect") {
        knowledgeInspect(args.slice(1));
        return;
    }
    if (subcommand === "forget") {
        knowledgeForget(args.slice(1));
        return;
    }

    printKnowledgeHelp();
}

function printKnowledgeHelp(): void {
    ChatLib.chat(`&7${chatSeparator()}`);
    ChatLib.chat(ChatLib.getCenteredText("&e&lHTSW &fKnowledge"));
    ChatLib.chat("");
    ChatLib.chat("&f/htsw knowledge status [import.json]");
    ChatLib.chat("&f/htsw knowledge inspect <type> <name>");
    ChatLib.chat("&f/htsw knowledge forget <type> <name>");
    ChatLib.chat(`&7${chatSeparator()}`);
}

function knowledgeStatus(args: string[]): void {
    const importPath = stripSurroundingQuotes(args.join(" ") || "import.json");
    const sm = new SourceMap(new FileSystemFileLoader());
    let result: ReturnType<typeof parseImportablesResult>;
    try {
        result = parseImportablesResult(sm, importPath);
    } catch (err) {
        ChatLib.chat("&cKnowledge status failed while parsing.");
        printKnowledgeError(sm, err);
        return;
    }

    printDiagnostics(sm, result.diagnostics);
    if (countBlockingDiagnostics(result.diagnostics) > 0) {
        ChatLib.chat("&cKnowledge status stopped because the source has errors.");
        return;
    }

    TaskManager.run(async (ctx) => {
        const housingUuid = await getCurrentHousingUuid(ctx);
        const rows = result.value.map((importable) =>
            buildStatusRow(housingUuid, importable)
        );
        const hits = rows.filter((row) => row.state === "hit").length;
        const stale = rows.filter((row) => row.state === "stale").length;
        const missing = rows.filter((row) => row.state === "missing").length;

        ctx.displayMessage(`&7${chatSeparator()}`);
        ctx.displayMessage(`&eKnowledge for &f${housingUuid}`);
        ctx.displayMessage(
            `&7${rows.length} importables: &a${hits} current &e${stale} stale &c${missing} missing`
        );
        for (const row of rows) {
            ctx.displayMessage(formatStatusRow(row));
        }
        ctx.displayMessage(`&7${chatSeparator()}`);
    }).catch((err) => {
        ChatLib.chat(`&cKnowledge status failed: ${err}`);
    });
}

function knowledgeInspect(args: string[]): void {
    const parsed = parseTypeAndIdentity(args);
    if (parsed === null) {
        ChatLib.chat("&cUsage: /htsw knowledge inspect <type> <name>");
        return;
    }

    TaskManager.run(async (ctx) => {
        const housingUuid = await getCurrentHousingUuid(ctx);
        const entry = readKnowledge(housingUuid, parsed.type, parsed.identity);
        if (entry === null) {
            ctx.displayMessage(
                `&cNo knowledge entry for ${parsed.type} ${parsed.identity}`
            );
            return;
        }

        ctx.displayMessage(`&7${chatSeparator()}`);
        ctx.displayMessage(`&e${entry.importable.type} &f${parsed.identity}`);
        ctx.displayMessage(`&7writer: &f${entry.writer}`);
        ctx.displayMessage(`&7written: &f${entry.writtenAt}`);
        ctx.displayMessage(`&7hash: &f${entry.hash}`);
        ctx.displayMessage(`&7lists: &f${Object.keys(entry.lists).length}`);
        for (const key of Object.keys(entry.lists).sort()) {
            ctx.displayMessage(`&7  ${key}: &f${entry.lists[key].length}`);
        }
        ctx.displayMessage(`&7${chatSeparator()}`);
    }).catch((err) => {
        ChatLib.chat(`&cKnowledge inspect failed: ${err}`);
    });
}

function knowledgeForget(args: string[]): void {
    const parsed = parseTypeAndIdentity(args);
    if (parsed === null) {
        ChatLib.chat("&cUsage: /htsw knowledge forget <type> <name>");
        return;
    }

    TaskManager.run(async (ctx) => {
        const housingUuid = await getCurrentHousingUuid(ctx);
        deleteKnowledge(housingUuid, parsed.type, parsed.identity);
        ctx.displayMessage(
            `&aDeleted knowledge for ${parsed.type} ${parsed.identity}`
        );
    }).catch((err) => {
        ChatLib.chat(`&cKnowledge forget failed: ${err}`);
    });
}

type StatusRow = {
    state: "hit" | "stale" | "missing";
    importable: Importable;
    hash: string;
    cachedHash?: string;
    writer?: string;
};

function buildStatusRow(housingUuid: string, importable: Importable): StatusRow {
    const identity = importableIdentity(importable);
    const hash = importableHash(importable);
    const entry = readKnowledge(housingUuid, importable.type, identity);
    if (entry === null) {
        return { state: "missing", importable, hash };
    }
    if (entry.hash !== hash) {
        return {
            state: "stale",
            importable,
            hash,
            cachedHash: entry.hash,
            writer: entry.writer,
        };
    }
    return {
        state: "hit",
        importable,
        hash,
        cachedHash: entry.hash,
        writer: entry.writer,
    };
}

function formatStatusRow(row: StatusRow): string {
    const identity = importableIdentity(row.importable);
    if (row.state === "hit") {
        return `&aOK &f${row.importable.type} &7${identity} &8${row.hash} &7${row.writer}`;
    }
    if (row.state === "stale") {
        return `&e! &f${row.importable.type} &7${identity} &8${row.cachedHash} -> ${row.hash}`;
    }
    return `&c- &f${row.importable.type} &7${identity} &8${row.hash}`;
}

function parseTypeAndIdentity(
    args: string[]
): { type: Importable["type"]; identity: string } | null {
    const type = parseImportableType(args[0]);
    if (type === null || args.length < 2) return null;
    const identity = stripSurroundingQuotes(args.slice(1).join(" "));
    if (identity.length === 0) return null;
    return { type, identity };
}

function parseImportableType(value: string | undefined): Importable["type"] | null {
    if (value === undefined) return null;
    const upper = value.toUpperCase();
    for (const type of IMPORTABLE_TYPES) {
        if (type === upper) return type;
    }
    return null;
}

function printKnowledgeError(sm: SourceMap, err: unknown): void {
    if (err instanceof Diagnostic) {
        printDiagnostic(sm, err);
        return;
    }
    ChatLib.chat(`&c${String(err)}`);
}

function countBlockingDiagnostics(diagnostics: Diagnostic[]): number {
    return diagnostics.filter((it) => it.level === "error" || it.level === "bug").length;
}
