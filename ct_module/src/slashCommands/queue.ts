import type { Importable } from "htsw/types";

import { queueModifiedImportables } from "../gui/autoTrack";
import { compactFileLabel } from "../gui/lib/pathDisplay";
import {
    parseImportJsonCurrent,
    parseImportJsonCurrentBlocking,
} from "../gui/parsing/parses";
import {
    addToQueue,
    clearQueue,
    getQueue,
    makeImportableQueueItem,
    removeFromQueue,
} from "../gui/right-panel/import-tab/queue";
import { startImport } from "../gui/right-panel/import-tab/taskController";
import { importableIdentity } from "../importables/identity";
import { resolveModuleRelativePath } from "../project/paths";
import { TaskManager } from "../tasks/manager";
import { isTaskRunning } from "../tasks/runningState";
import { stripSurroundingQuotes } from "../utils/helpers";

const IMPORTABLE_TYPES: Importable["type"][] = [
    "FUNCTION",
    "EVENT",
    "REGION",
    "ITEM",
    "MENU",
    "NPC",
    "TEAM",
    "GROUP",
    "COMMAND",
];

export function commandQueue(args: string[]): void {
    const action = args.length === 0 ? "" : args[0].toLowerCase();
    if (action === "add") {
        void commandQueueAdd(args.slice(1));
    } else if (action === "modified") {
        commandQueueModified(args.slice(1));
    } else if (action === "list") {
        commandQueueList();
    } else if (action === "remove") {
        commandQueueRemove(args.slice(1));
    } else if (action === "clear") {
        commandQueueClear();
    } else if (action === "run") {
        commandQueueRun();
    } else {
        printQueueUsage();
    }
}

function printQueueUsage(): void {
    ChatLib.chat("&7[htsw] /htsw queue add <import.json path>");
    ChatLib.chat(
        "&7[htsw] /htsw queue add <import.json path> <TYPE> <identity...>"
    );
    ChatLib.chat("&7[htsw] /htsw queue modified <import.json path>");
    ChatLib.chat("&7[htsw] /htsw queue list");
    ChatLib.chat("&7[htsw] /htsw queue remove <index>");
    ChatLib.chat("&7[htsw] /htsw queue clear");
    ChatLib.chat("&7[htsw] /htsw queue run");
}

async function commandQueueAdd(args: string[]): Promise<void> {
    if (args.length === 0) {
        ChatLib.chat("&c[htsw] Usage: /htsw queue add <import.json path>");
        return;
    }

    const split = splitAddArguments(args);
    if (split === null) {
        ChatLib.chat(`&c[htsw] File does not exist '${resolvePath(args)}'`);
        return;
    }
    const path = split.path;
    if (split.remaining.length === 0) {
        const parsed = await parseImportJsonCurrent(path);
        if (parsed.parsed === null) {
            ChatLib.chat(
                `&c[htsw] Could not parse ${compactFileLabel(path)}: ${parsed.error ?? "parse failed"}`
            );
            return;
        }
        const added = addToQueue({
            operation: "import",
            kind: "importJson",
            sourcePath: parsed.canonicalPath,
            label: compactFileLabel(parsed.canonicalPath),
        });
        ChatLib.chat(
            `&a[htsw] ${added ? "Queued" : "Already queued"} IMPORT_JSON ${compactFileLabel(parsed.canonicalPath)}`
        );
        return;
    }

    const rawType = split.remaining[0].toUpperCase();
    if (IMPORTABLE_TYPES.indexOf(rawType as Importable["type"]) < 0) {
        ChatLib.chat(`&c[htsw] Invalid importable type '${split.remaining[0]}'`);
        return;
    }
    const type = rawType as Importable["type"];
    const identity = stripSurroundingQuotes(split.remaining.slice(1).join(" "));
    if (identity.length === 0) {
        ChatLib.chat(
            "&c[htsw] Usage: /htsw queue add <import.json path> <TYPE> <identity...>"
        );
        return;
    }
    const cached = await parseImportJsonCurrent(path);
    if (cached.parsed === null) {
        ChatLib.chat(
            `&c[htsw] Could not parse ${compactFileLabel(path)}: ${cached.error ?? "parse failed"}`
        );
        return;
    }
    const available: string[] = [];
    let match: Importable | null = null;
    for (const imp of cached.parsed.value) {
        if (imp.type !== type) continue;
        const candidate = importableIdentity(imp);
        available.push(candidate);
        if (candidate === identity) match = imp;
    }
    if (match === null) {
        ChatLib.chat(
            `&c[htsw] No ${type} '${identity}' in ${compactFileLabel(cached.canonicalPath)}`
        );
        if (available.length === 0) {
            ChatLib.chat(
                `&c[htsw] No ${type} importables declared in ${compactFileLabel(cached.canonicalPath)}`
            );
        } else {
            for (let i = 0; i < available.length; i++) {
                ChatLib.chat(`&7[htsw] Available ${type}: &f${available[i]}`);
            }
        }
        return;
    }

    const added = addToQueue(makeImportableQueueItem(match, cached.canonicalPath));
    ChatLib.chat(
        `&a[htsw] ${added ? "Queued" : "Already queued"} ${type} ${identity} from ${compactFileLabel(cached.canonicalPath)}`
    );
}

function splitAddArguments(
    args: string[]
): { path: string; remaining: string[] } | null {
    for (let i = 1; i <= args.length; i++) {
        const path = resolvePath(args.slice(0, i));
        if (FileLib.exists(path)) {
            return { path, remaining: args.slice(i) };
        }
    }
    return null;
}

function resolvePath(args: string[]): string {
    return resolveModuleRelativePath(stripSurroundingQuotes(args.join(" ")));
}

function commandQueueModified(args: string[]): void {
    if (args.length === 0) {
        ChatLib.chat(
            "&c[htsw] Usage: /htsw queue modified <import.json path>"
        );
        return;
    }
    const path = resolvePath(args);
    const cached = parseImportJsonCurrentBlocking(path);
    if (cached.parsed === null) {
        ChatLib.chat(
            `&c[htsw] Could not parse ${compactFileLabel(path)}: ${cached.error ?? "parse failed"}`
        );
        return;
    }
    queueModifiedImportables(cached.canonicalPath, cached.parsed, undefined, {
        blockingCacheRead: true,
    });
    ChatLib.chat(`&a[htsw] Queue now contains ${getQueue().length} item(s)`);
}

function commandQueueList(): void {
    const queue = getQueue();
    if (queue.length === 0) {
        ChatLib.chat("&7[htsw] Queue is empty");
        return;
    }
    for (let i = 0; i < queue.length; i++) {
        const item = queue[i];
        if (item.operation === "import" && item.kind === "importJson") {
            ChatLib.chat(
                `&7[htsw] ${i + 1}. &fimport/importJson IMPORT_JSON ${item.label} ${compactFileLabel(item.sourcePath)}`
            );
        } else if (item.operation === "import") {
            ChatLib.chat(
                `&7[htsw] ${i + 1}. &fimport/importable ${item.type} ${item.identity} ${compactFileLabel(item.sourcePath)}`
            );
        } else {
            ChatLib.chat(
                `&7[htsw] ${i + 1}. &f${item.operation}/importable ${item.type} ${item.identity} ${compactFileLabel(item.destinationPath)}`
            );
        }
    }
}

function commandQueueRemove(args: string[]): void {
    if (isTaskRunning()) {
        ChatLib.chat("&c[htsw] Cannot remove queue items while a task is running");
        return;
    }
    const index = Number(args[0]);
    const queue = getQueue();
    if (
        args.length !== 1 ||
        !isFinite(index) ||
        Math.floor(index) !== index ||
        index < 1 ||
        index > queue.length
    ) {
        ChatLib.chat(`&c[htsw] Invalid queue index '${args[0] ?? ""}'`);
        return;
    }
    removeFromQueue(queue[index - 1]);
    ChatLib.chat(`&a[htsw] Removed queue item ${index}`);
}

function commandQueueClear(): void {
    if (isTaskRunning()) {
        ChatLib.chat("&c[htsw] Cannot clear the queue while a task is running");
        return;
    }
    clearQueue();
    ChatLib.chat("&a[htsw] Queue cleared");
}

function commandQueueRun(): void {
    if (getQueue().length === 0) {
        ChatLib.chat("&c[htsw] Queue is empty");
        return;
    }
    if (TaskManager.isBusy()) {
        ChatLib.chat(
            "&c[htsw] An import (or another task) is already running — wait for it to finish first."
        );
        return;
    }
    ChatLib.chat(`&a[htsw] Running queue with ${getQueue().length} item(s)`);
    startImport();
}
