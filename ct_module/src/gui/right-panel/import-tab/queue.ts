/// <reference types="../../../../CTAutocomplete" />

import type { Importable } from "htsw/types";

import {
    canonicalPath,
    forEachCachedParse,
    getParseCacheRevision,
    type CachedParse,
} from "../../parsing/parses";
import { importableFilePaths } from "../../parsing/importablePaths";
import { importableIdentity } from "../../../importables/identity";
import { markGuiDirty } from "../../lib/dirty";

/**
 * Right-panel run queue. Import entries are real work selected by the user;
 * export/read entries are progress rows for work selected from the Houses tab.
 * The item shape keeps those meanings separate so callers can't reuse an
 * import `sourcePath` as an export destination by accident.
 */

export type ImportQueueItem =
    | {
          operation: "import";
          kind: "importable";
          /** Canonical absolute path of the declaring import.json. */
          sourcePath: string;
          identity: string;
          type: Importable["type"];
          /** Display label (importable name / event constant). */
          label: string;
      }
    | {
          operation: "import";
          kind: "importJson";
          /** Canonical absolute path of the import.json itself. */
          sourcePath: string;
          /** Display label (typically the import.json's basename). */
          label: string;
      };

export type ExportQueueItem = {
    operation: "export" | "read";
    kind: "importable";
    /** Destination import.json for export, or the active project path for reads. */
    destinationPath: string;
    /** House being read/exported from. Null when not known by the caller. */
    housingUuid: string | null;
    identity: string;
    type: Importable["type"];
    label: string;
};

export type QueueItem = ImportQueueItem | ExportQueueItem;

/** Stable identity string for a queue item. Used for set membership / removal. */
export function queueItemKey(item: QueueItem): string {
    if (item.operation === "import" && item.kind === "importable") {
        return `imp:${item.sourcePath}|${item.type}:${item.identity}`;
    }
    if (item.operation === "import" && item.kind === "importJson") {
        return `json:${item.sourcePath}`;
    }
    return `${item.operation}:${item.destinationPath}|${item.type}:${item.identity}`;
}

export function queueItemProgressPath(item: QueueItem): string | null {
    if (item.operation === "import") return item.sourcePath;
    return item.destinationPath;
}

export function isImportQueueItem(item: QueueItem): item is ImportQueueItem {
    return item.operation === "import";
}

let items: QueueItem[] = [];

/**
 * Keys of the queue items that belong to the currently-running import
 * session (snapshotted when the import started). Null when no import is
 * running. Items added to the queue *after* an import starts are not in
 * this set — they're "pending" and survive the post-success clear, which
 * only removes session items. The display draws a divider between the two
 * groups, and session items can't be removed mid-run.
 */
let sessionKeys: Set<string> | null = null;

export function getQueue(): readonly QueueItem[] {
    return items;
}

export function beginQueueSession(): void {
    sessionKeys = new Set<string>();
    for (let i = 0; i < items.length; i++) {
        sessionKeys.add(queueItemKey(items[i]));
    }
    markGuiDirty();
}

/**
 * End the active queue session. When `removeSessionItems` is true (a fully
 * successful run) the session items are dropped from the queue, leaving
 * only pending adds. When false (cancel / failure) the items stay so the
 * user can retry; only the session marking is cleared.
 */
export function endQueueSession(removeSessionItems: boolean): void {
    const hadSession = sessionKeys !== null;
    const beforeLen = items.length;
    if (sessionKeys !== null && removeSessionItems) {
        const keys = sessionKeys;
        items = items.filter((i) => !keys.has(queueItemKey(i)));
    }
    sessionKeys = null;
    if (hadSession || items.length !== beforeLen) markGuiDirty();
}

export function isQueueSessionItem(key: string): boolean {
    return sessionKeys !== null && sessionKeys.has(key);
}

export function getQueueLength(): number {
    return items.length;
}

export function isInQueue(key: string): boolean {
    for (let i = 0; i < items.length; i++) if (queueItemKey(items[i]) === key) return true;
    return false;
}

export function addToQueue(item: QueueItem): boolean {
    const key = queueItemKey(item);
    if (isInQueue(key)) return false;
    items = items.concat([item]);
    markGuiDirty();
    return true;
}

export function removeFromQueueKey(key: string): void {
    const beforeLen = items.length;
    items = items.filter((i) => queueItemKey(i) !== key);
    if (items.length !== beforeLen) markGuiDirty();
}
/** Toggle membership. Returns the *new* state (true = now in the queue). */
export function toggleQueue(item: QueueItem): boolean {
    const key = queueItemKey(item);
    if (isInQueue(key)) {
        removeFromQueueKey(key);
        return false;
    }
    return addToQueue(item);
}

export function clearQueue(): void {
    if (items.length === 0 && sessionKeys === null) return;
    items = [];
    sessionKeys = null;
    markGuiDirty();
}

/**
 * Split the queue into the active-session group and the pending group for
 * display, each sorted into execution order. When no import is running
 * every item is "active" and `showDivider` is false. During a run, items
 * added after the start fall into `pending`, and the divider shows only
 * when there's something pending to separate.
 */
export function queueDisplayGroups(): {
    active: QueueItem[];
    pending: QueueItem[];
    showDivider: boolean;
} {
    if (sessionKeys === null) {
        return { active: sortedQueueForDisplay(items), pending: [], showDivider: false };
    }
    const keys = sessionKeys;
    const active: QueueItem[] = [];
    const pending: QueueItem[] = [];
    for (const item of items) {
        if (keys.has(queueItemKey(item))) active.push(item);
        else pending.push(item);
    }
    return {
        active: sortedQueueForDisplay(active),
        pending: sortedQueueForDisplay(pending),
        showDivider: pending.length > 0,
    };
}

/**
 * Returns the queue items sorted to match execution order: ITEMs first
 * (because action lists reference items by name and need them to exist
 * first), then the rest in queue insertion order. importJson group rows
 * are kept in insertion order alongside the non-ITEM importables. Use
 * this for display so the user sees the same order things will run in.
 */
function sortedQueueForDisplay(queue: readonly QueueItem[]): QueueItem[] {
    const itemImportables: QueueItem[] = [];
    const rest: QueueItem[] = [];
    for (const item of queue) {
        if (item.operation === "import" && item.kind === "importable" && item.type === "ITEM") {
            itemImportables.push(item);
        } else {
            rest.push(item);
        }
    }
    return itemImportables.concat(rest);
}

// ── Path-based helpers ─────────────────────────────────────────────────

/**
 * Build queue items for importables whose source file matches `filePath`.
 * import.json files are deliberately not returned as a single bulk item; UI
 * rows that want "everything under this import.json" add those importables
 * individually so queue rows stay concrete.
 */
export function queueItemsForPath(filePath: string, importJsonPath?: string | null): QueueItem[] {
    const target = canonicalPath(filePath);
    return findImportableQueueItems(target, importJsonPath);
}

// Per-(target, parse-cache revision) memo. The scan touches every importable
// in every cached parse; the tab strip calls it per file tab per frame (via
// `queuedCountForTab`). Membership in the queue is applied by the caller, so
// this result depends only on the parse cache and is safe to reuse until it
// changes.
let queueItemsCacheRev = -1;
const queueItemsCache = new Map<string, QueueItem[]>();

/**
 * Locate every importable across every cached parse whose source file
 * matches `target` (canonical). Returns one queue item per match.
 */
function findImportableQueueItems(target: string, importJsonPath?: string | null): QueueItem[] {
    const rev = getParseCacheRevision();
    if (rev !== queueItemsCacheRev) {
        queueItemsCache.clear();
        queueItemsCacheRev = rev;
    }
    const scope =
        importJsonPath === null || importJsonPath === undefined || importJsonPath === ""
            ? ""
            : canonicalPath(importJsonPath);
    const cacheKey = `${scope}\n${target}`;
    const cached = queueItemsCache.get(cacheKey);
    if (cached !== undefined) return cached;
    const out: QueueItem[] = [];
    const visit = (entry: CachedParse): void => {
        if (entry.parsed === null) return;
        for (const imp of entry.parsed.value) {
            const paths = importableFilePaths(imp, entry.parsed);
            let matches = false;
            for (let i = 0; i < paths.length; i++) {
                if (canonicalPath(paths[i]) === target) {
                    matches = true;
                    break;
                }
            }
            if (!matches) continue;
            out.push({
                operation: "import",
                kind: "importable",
                sourcePath: entry.canonicalPath,
                identity: importableIdentity(imp),
                type: imp.type,
                label: importableLabel(imp),
            });
        }
    };
    if (scope !== "") {
        let found = false;
        forEachCachedParse((entry) => {
            if (found || entry.canonicalPath !== scope) return;
            found = true;
            visit(entry);
        });
    } else {
        forEachCachedParse(visit);
    }
    queueItemsCache.set(cacheKey, out);
    return out;
}

function importableLabel(imp: Importable): string {
    return imp.type === "EVENT" ? imp.event : imp.name;
}

/**
 * Convenience: the item that corresponds to a specific `Importable`
 * object pulled from a known parse. Used by Importables row right-clicks
 * which already have the importable in hand and don't need to scan.
 */
export function makeImportableQueueItem(
    imp: Importable,
    declaringImportJson: string
): ImportQueueItem {
    return {
        operation: "import",
        kind: "importable",
        sourcePath: canonicalPath(declaringImportJson),
        identity: importableIdentity(imp),
        type: imp.type,
        label: importableLabel(imp),
    };
}

export function makeExportQueueItem(
    operation: "export" | "read",
    type: Importable["type"],
    identity: string,
    destinationPath: string,
    housingUuid: string | null
): ExportQueueItem {
    return {
        operation,
        kind: "importable",
        destinationPath: canonicalPath(destinationPath),
        housingUuid,
        identity,
        type,
        label: identity,
    };
}
