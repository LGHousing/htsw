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
 * export/read entries are queue rows for work selected from the Houses tab.
 * The item shape keeps those meanings separate so callers can't reuse an
 * import `sourcePath` as an export destination by accident.
 */

export type ImportQueueItem =
    | {
          operation: "import";
          kind: "importable";
          /**
           * Canonical absolute path of the top-level import.json the import
           * session runs from (the parse-cache entry) — NOT the nested
           * import.json that declares the importable. Where it lives in the
           * include tree is derived from the parse at use time
           * (`findImportableHome` in the include-tree helpers), so it stays correct
           * if the importable is moved while queued.
           */
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
const queueItemKeys = new WeakMap<QueueItem, string>();

export function queueItemKey(item: QueueItem): string {
    const cached = queueItemKeys.get(item);
    if (cached !== undefined) return cached;
    let key: string;
    if (item.operation === "import" && item.kind === "importable") {
        key = `imp:${item.sourcePath}|${item.type}:${item.identity}`;
    } else if (item.kind === "importJson") {
        key = `json:${item.sourcePath}`;
    } else {
        key = `${item.operation}:${item.destinationPath}|${item.type}:${item.identity}`;
    }
    queueItemKeys.set(item, key);
    return key;
}

export function queueItemProgressPath(item: QueueItem): string | null {
    if (item.operation === "import") return item.sourcePath;
    return item.destinationPath;
}

export function isImportQueueItem(item: QueueItem): item is ImportQueueItem {
    return item.operation === "import";
}

let items: QueueItem[] = [];
let itemsRevision = 0;
let lookupRevision = -1;
const byKey = new Map<string, number>();
const byImportWork = new Map<string, number>();

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

function queueChanged(): void {
    markGuiDirty();
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
        itemsRevision++;
    }
    sessionKeys = null;
    if (hadSession || items.length !== beforeLen) queueChanged();
}

export function isQueueSessionItem(key: string): boolean {
    return sessionKeys !== null && sessionKeys.has(key);
}

export function getQueueLength(): number {
    return items.length;
}

function importWorkKey(item: QueueItem): string | null {
    return item.operation === "import" && item.kind === "importable"
        ? `${item.type}:${item.identity}`
        : null;
}

function rebuildQueueLookups(): void {
    byKey.clear();
    byImportWork.clear();
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const key = queueItemKey(item);
        if (!byKey.has(key)) byKey.set(key, i);
        const workKey = importWorkKey(item);
        if (workKey !== null && !byImportWork.has(workKey)) byImportWork.set(workKey, i);
    }
    lookupRevision = itemsRevision;
}

function queuedItemIndex(item: QueueItem): number {
    if (lookupRevision !== itemsRevision) rebuildQueueLookups();
    const keyIndex = byKey.get(queueItemKey(item));
    const workKey = importWorkKey(item);
    const workIndex = workKey === null ? undefined : byImportWork.get(workKey);
    if (keyIndex === undefined) return workIndex === undefined ? -1 : workIndex;
    return workIndex === undefined ? keyIndex : Math.min(keyIndex, workIndex);
}

export function getQueuedItemKey(item: QueueItem): string | null {
    const index = queuedItemIndex(item);
    return index < 0 ? null : queueItemKey(items[index]);
}

export function isQueueItemQueued(item: QueueItem): boolean {
    return queuedItemIndex(item) >= 0;
}

export function addToQueue(item: QueueItem): boolean {
    if (isQueueItemQueued(item)) return false;
    items = items.concat([item]);
    itemsRevision++;
    queueChanged();
    return true;
}

/**
 * Add an item mid-run as part of the active session. The importer widens
 * its work set after the session snapshot (click-action item dependencies),
 * so a plain addToQueue would land the row in the "pending" group below the
 * divider — session-marking it keeps the visible queue matching what the
 * run is actually doing.
 */
export function addSessionQueueItem(item: QueueItem): void {
    addToQueue(item);
    const key = getQueuedItemKey(item);
    if (sessionKeys !== null && key !== null && !sessionKeys.has(key)) {
        sessionKeys.add(key);
        markGuiDirty();
    }
}

export function removeFromQueueKey(key: string): void {
    const beforeLen = items.length;
    items = items.filter((i) => queueItemKey(i) !== key);
    itemsRevision++;
    if (items.length !== beforeLen) queueChanged();
}

export function removeFromQueue(item: QueueItem): void {
    const index = queuedItemIndex(item);
    if (index < 0) return;
    items = items.slice(0, index).concat(items.slice(index + 1));
    itemsRevision++;
    queueChanged();
}

/** Toggle membership. Returns the *new* state (true = now in the queue). */
export function toggleQueue(item: QueueItem): boolean {
    if (isQueueItemQueued(item)) {
        removeFromQueue(item);
        return false;
    }
    return addToQueue(item);
}

export function clearQueue(): void {
    if (items.length === 0 && sessionKeys === null) return;
    items = [];
    itemsRevision++;
    sessionKeys = null;
    queueChanged();
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

export function queueItemsCacheSize(): number {
    return queueItemsCache.size;
}

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
            const paths = importableFilePaths(imp);
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
 * object pulled from a known parse. Used by Projects row right-clicks
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
    housingUuid: string | null,
    label: string = identity
): ExportQueueItem {
    return {
        operation,
        kind: "importable",
        destinationPath: canonicalPath(destinationPath),
        housingUuid,
        identity,
        type,
        label,
    };
}
