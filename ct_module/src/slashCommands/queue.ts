import type { Importable } from "htsw/types";

import { autoRunQueueChanged, setAutoRunEnabled } from "../gui/autoRun";
import { getExportDestinationStatus } from "../gui/export/destinationStatus";
import { compactFileLabel } from "../gui/lib/pathDisplay";
import {
    parseImportJsonCurrent,
    parseImportJsonCurrentBlocking,
} from "../gui/parsing/parses";
import { getHousingUuid } from "../gui/state";
import {
    addQueueRow,
    clearQueue,
    getQueue,
    makeBulkQueueRow,
    makeImportableQueueRow,
    removeQueueRow,
    retryQueueRow,
    type QueueAddResult,
    type QueueRow,
} from "../gui/right-panel/import-tab/queue";
import {
    isQueueRunning,
    pauseQueue,
    startQueue,
} from "../gui/right-panel/import-tab/queueRunner";
import { houseDisplayName } from "../importCache/aliases";
import { importableIdentity } from "../importables/identity";
import {
    HOUSE_READABLE_TYPES,
    type HouseReadableType,
} from "../importables/export/readers";
import { resolveModuleRelativePath } from "../project/paths";
import { getAutoRun } from "../settings";
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
    if (action === "add") void commandQueueAdd(args.slice(1));
    else if (action === "modified") commandQueueModified(args.slice(1));
    else if (action === "export") commandQueueHouseOperation("export", args.slice(1));
    else if (action === "read") commandQueueHouseOperation("read", args.slice(1));
    else if (action === "list") commandQueueList();
    else if (action === "remove") commandQueueRemove(args.slice(1));
    else if (action === "retry") commandQueueRetry(args.slice(1));
    else if (action === "clear") commandQueueClear();
    else if (action === "run") commandQueueRun();
    else if (action === "pause") commandQueuePause();
    else if (action === "autorun") commandQueueAutoRun(args.slice(1));
    else printQueueUsage();
}

function printQueueUsage(): void {
    ChatLib.chat("&7[htsw] /htsw queue add <import.json path>");
    ChatLib.chat("&7[htsw] /htsw queue add <import.json path> <TYPE> <identity...>");
    ChatLib.chat("&7[htsw] /htsw queue modified <import.json path>");
    ChatLib.chat("&7[htsw] /htsw queue export <TYPE> <all|new|changed|identity...>");
    ChatLib.chat("&7[htsw] /htsw queue read <TYPE> <all|changed|identity...>");
    ChatLib.chat("&7[htsw] /htsw queue list");
    ChatLib.chat("&7[htsw] /htsw queue remove <index>");
    ChatLib.chat("&7[htsw] /htsw queue retry <index>");
    ChatLib.chat("&7[htsw] /htsw queue clear");
    ChatLib.chat("&7[htsw] /htsw queue run|pause");
    ChatLib.chat("&7[htsw] /htsw queue autorun <on|off>");
}

function rowAdded(result: QueueAddResult): boolean {
    return result.kind === "added" || result.kind === "alsoQueuedOtherDirection";
}

function addUserRow(row: QueueRow): QueueAddResult {
    const result = addQueueRow(row);
    if (rowAdded(result)) autoRunQueueChanged();
    return result;
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
    const cached = await parseImportJsonCurrent(path);
    if (cached.parsed === null) {
        ChatLib.chat(
            `&c[htsw] Could not parse ${compactFileLabel(path)}: ${cached.error ?? "parse failed"}`
        );
        return;
    }

    if (split.remaining.length === 0) {
        const result = addUserRow(
            makeBulkQueueRow({
                op: "import",
                house: cached.parsed.importJson.houseUuid,
                path: cached.canonicalPath,
                scope: { kind: "file", path: cached.canonicalPath },
                filter: "all",
                label: `Import ${compactFileLabel(cached.canonicalPath)}`,
            })
        );
        ChatLib.chat(
            `&a[htsw] ${rowAdded(result) ? "Queued" : "Already queued"} IMPORT_JSON ${compactFileLabel(cached.canonicalPath)}`
        );
        return;
    }

    const type = parseImportableType(split.remaining[0]);
    if (type === null) {
        ChatLib.chat(`&c[htsw] Invalid importable type '${split.remaining[0]}'`);
        return;
    }
    const identity = stripSurroundingQuotes(split.remaining.slice(1).join(" "));
    if (identity.length === 0) {
        ChatLib.chat(
            "&c[htsw] Usage: /htsw queue add <import.json path> <TYPE> <identity...>"
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
            for (const candidate of available) {
                ChatLib.chat(`&7[htsw] Available ${type}: &f${candidate}`);
            }
        }
        return;
    }

    const result = addUserRow(
        makeImportableQueueRow({
            op: "import",
            house: cached.parsed.importJson.houseUuid,
            path: cached.canonicalPath,
            type,
            identity,
            label: match.type === "EVENT" ? match.event : match.name,
        })
    );
    ChatLib.chat(
        `&a[htsw] ${rowAdded(result) ? "Queued" : "Already queued"} ${type} ${identity} from ${compactFileLabel(cached.canonicalPath)}`
    );
}

function commandQueueModified(args: string[]): void {
    if (args.length === 0) {
        ChatLib.chat("&c[htsw] Usage: /htsw queue modified <import.json path>");
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
    addUserRow(
        makeBulkQueueRow({
            op: "import",
            house: cached.parsed.importJson.houseUuid,
            path: cached.canonicalPath,
            scope: { kind: "file", path: cached.canonicalPath },
            filter: "modified",
            label: `Import modified in ${compactFileLabel(cached.canonicalPath)}`,
        })
    );
    ChatLib.chat(`&a[htsw] Queue now contains ${getQueue().length} item(s)`);
}

function commandQueueHouseOperation(op: "export" | "read", args: string[]): void {
    const type = parseReadableType(args[0]);
    const selector = stripSurroundingQuotes(args.slice(1).join(" "));
    if (type === null || selector.length === 0) {
        ChatLib.chat(
            `&c[htsw] Usage: /htsw queue ${op} <TYPE> <${op === "export" ? "all|new|changed|" : "all|changed|"}identity...>`
        );
        return;
    }
    const destination = getExportDestinationStatus();
    if (destination.kind !== "ready") {
        ChatLib.chat(
            destination.kind === "missing"
                ? `&c[htsw] Export project is missing: ${destination.path}`
                : "&c[htsw] Choose an export project in the Houses tab first."
        );
        return;
    }
    const house = getHousingUuid();
    if (house === null) {
        ChatLib.chat("&c[htsw] Enter a Housing house first.");
        return;
    }

    const filter = selector.toLowerCase();
    if (filter === "modified") {
        ChatLib.chat(
            `&c[htsw] ${op === "export" ? "Export" : "Read"} does not support the modified filter.`
        );
        return;
    }
    if (filter === "new" && op === "read") {
        ChatLib.chat("&c[htsw] Read supports all, changed, or an identity.");
        return;
    }
    const result =
        filter === "all" || filter === "new" || filter === "changed"
            ? addUserRow(
                  makeBulkQueueRow({
                      op,
                      house,
                      path: destination.path,
                      scope: { kind: "houseType", type },
                      filter,
                      label: `${op === "export" ? "Export" : "Read"} ${filter} ${type.toLowerCase()}s`,
                  })
              )
            : addUserRow(
                  makeImportableQueueRow({
                      op,
                      house,
                      path: destination.path,
                      type,
                      identity: selector,
                      label: selector,
                  })
              );
    ChatLib.chat(
        rowAdded(result)
            ? `&a[htsw] Queued ${op} ${type} ${selector}`
            : `&e[htsw] ${result.message}`
    );
}

function commandQueueList(): void {
    const queue = getQueue();
    if (queue.length === 0) {
        ChatLib.chat("&7[htsw] Queue is empty");
        return;
    }
    for (let i = 0; i < queue.length; i++) {
        const row = queue[i];
        const house = row.house === null ? "any house" : houseDisplayName(row.house);
        const target =
            row.target.kind === "importable"
                ? `${row.target.type} ${row.target.identity}`
                : row.target.label;
        ChatLib.chat(
            `&7[htsw] ${i + 1}. &f${row.op} ${target} &7in ${house} [${row.status}] ${compactFileLabel(row.path)}`
        );
    }
}

function queueIndex(args: string[]): number | null {
    const index = Number(args[0]);
    if (
        args.length !== 1 ||
        !isFinite(index) ||
        Math.floor(index) !== index ||
        index < 1 ||
        index > getQueue().length
    ) {
        ChatLib.chat(`&c[htsw] Invalid queue index '${args[0] ?? ""}'`);
        return null;
    }
    return index - 1;
}

function commandQueueRemove(args: string[]): void {
    if (isQueueRunning()) {
        ChatLib.chat("&c[htsw] Cannot remove queue items while the queue is running");
        return;
    }
    const index = queueIndex(args);
    if (index === null) return;
    const row = getQueue()[index];
    if (!removeQueueRow(row.key)) return;
    ChatLib.chat(`&a[htsw] Removed queue item ${index + 1}`);
}

function commandQueueRetry(args: string[]): void {
    const index = queueIndex(args);
    if (index === null) return;
    const row = getQueue()[index];
    if (!retryQueueRow(row.key)) {
        ChatLib.chat(`&c[htsw] Queue item ${index + 1} has not failed.`);
        return;
    }
    ChatLib.chat(`&a[htsw] Retrying queue item ${index + 1}`);
    autoRunQueueChanged();
}

function commandQueueClear(): void {
    if (isQueueRunning()) {
        ChatLib.chat("&c[htsw] Cannot clear the queue while it is running");
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
    const count = getQueue().length;
    if (startQueue()) ChatLib.chat(`&a[htsw] Running queue with ${count} item(s)`);
    else
        ChatLib.chat("&c[htsw] The queue could not start while another task is running.");
}

function commandQueuePause(): void {
    const result = pauseQueue();
    if (result === null) ChatLib.chat("&7[htsw] The queue is not running.");
    else ChatLib.chat("&e[htsw] Pausing the queue…");
}

function commandQueueAutoRun(args: string[]): void {
    const action = (args[0] ?? "").toLowerCase();
    if (action === "on" || action === "off") {
        setAutoRunEnabled(action === "on");
        return;
    }
    ChatLib.chat(`&7[htsw] Auto-run is ${getAutoRun() ? "&aon" : "&coff"}&7.`);
    ChatLib.chat("&7[htsw] Usage: /htsw queue autorun <on|off>");
}

function parseImportableType(raw: string | undefined): Importable["type"] | null {
    const type = (raw ?? "").toUpperCase() as Importable["type"];
    return IMPORTABLE_TYPES.indexOf(type) >= 0 ? type : null;
}

function parseReadableType(raw: string | undefined): HouseReadableType | null {
    const type = parseImportableType(raw);
    if (type === null) return null;
    return HOUSE_READABLE_TYPES.indexOf(type as HouseReadableType) >= 0
        ? (type as HouseReadableType)
        : null;
}

function splitAddArguments(args: string[]): { path: string; remaining: string[] } | null {
    for (let i = 1; i <= args.length; i++) {
        const path = resolvePath(args.slice(0, i));
        if (FileLib.exists(path)) return { path, remaining: args.slice(i) };
    }
    return null;
}

function resolvePath(args: string[]): string {
    return resolveModuleRelativePath(stripSurroundingQuotes(args.join(" ")));
}
