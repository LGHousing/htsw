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
    all: boolean;
    type: Importable["type"];
    label: string;
};

export type QueueItem = ImportQueueItem | ExportQueueItem;

export type QueueItemState = {
    status: "queued" | "blocked" | "running" | "failed" | "cancelled";
    error: string | null;
};

export type QueueAddResult =
    | { kind: "added"; key: string }
    | { kind: "duplicate"; key: string }
    | { kind: "blocked"; key: string; conflictingKey: string; error: string };

export type QueueExecutionResult =
    { kind: "success" } | { kind: "failed"; error: string } | { kind: "cancelled" };

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
        key = `${item.operation}:${item.housingUuid ?? "unknown-house"}|${item.destinationPath}|${item.type}:${item.identity}`;
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
const itemStates = new Map<string, QueueItemState>();
let itemsRevision = 0;
let lookupRevision = -1;
const byKey = new Map<string, number>();
const byImportWork = new Map<string, number>();
const autoTrackedKeys = new Set<string>();

/**
 * Keys of the queue items that belong to the currently-running import
 * session (snapshotted when the import started). Null when no import is
 * running. Items added to the queue *after* an import starts are not in
 * this set — they're "pending" and survive the post-success clear, which
 * only removes session items. The display draws a divider between the two
 * groups, and session items can't be removed mid-run.
 */
let sessionKeys: Set<string> | null = null;

/**
 * Keys of rows brought back from a saved workspace that Auto-Track has not
 * independently re-detected yet.
 *
 * Watch mode fires whenever tracked work sits in the queue. Before the queue
 * persisted, an empty queue after a reload was what kept it from importing
 * unprompted; restoring rows removes that accident, so restored rows are
 * explicitly not watch-eligible. A row leaves this set the moment Auto-Track
 * reports it as genuinely changed, which is the same evidence watch mode
 * would have waited for anyway.
 */
const restoredKeys = new Set<string>();

export function isRestoredQueueItem(key: string): boolean {
    return restoredKeys.has(key);
}

export function getQueue(): readonly QueueItem[] {
    return items;
}

function queueChanged(): void {
    markGuiDirty();
}

export function beginQueueSession(keys?: readonly string[]): void {
    sessionKeys = new Set<string>();
    if (keys !== undefined) {
        for (let i = 0; i < keys.length; i++) sessionKeys.add(keys[i]);
    } else {
        for (let i = 0; i < items.length; i++) {
            sessionKeys.add(queueItemKey(items[i]));
        }
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
        items = items.filter((i) => {
            const key = queueItemKey(i);
            if (!keys.has(key)) return true;
            autoTrackedKeys.delete(key);
            restoredKeys.delete(key);
            return false;
        });
        for (const key of keys) itemStates.delete(key);
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

export function hasRunnableQueueItem(): boolean {
    for (let i = 0; i < items.length; i++) {
        const status = stateForKey(queueItemKey(items[i])).status;
        if (status === "running") continue;
        return status === "queued";
    }
    return false;
}

function importWorkKey(item: QueueItem): string | null {
    return item.operation === "import" && item.kind === "importable"
        ? `${item.type}:${item.identity}`
        : null;
}

function targetsOverlap(left: QueueItem, right: QueueItem): boolean {
    if (left.kind !== "importable" || right.kind !== "importable") return false;
    if (left.type !== right.type) return false;
    const leftAll = left.operation !== "import" && left.all;
    const rightAll = right.operation !== "import" && right.all;
    return leftAll || rightAll || left.identity === right.identity;
}

function operationsConflict(left: QueueItem, right: QueueItem): boolean {
    if (left.operation === right.operation) return false;
    if (left.kind === "importJson" || right.kind === "importJson") return true;
    return targetsOverlap(left, right);
}

function sameOperationOverlap(left: QueueItem, right: QueueItem): boolean {
    if (left.operation !== right.operation) return false;
    if (left.operation === "import" || right.operation === "import") return false;
    return (
        left.destinationPath === right.destinationPath &&
        left.housingUuid === right.housingUuid &&
        targetsOverlap(left, right)
    );
}

function operationLabel(item: QueueItem): string {
    return item.operation.charAt(0).toUpperCase() + item.operation.substring(1);
}

function stateForKey(key: string): QueueItemState {
    return itemStates.get(key) ?? { status: "queued", error: null };
}

export function getQueueItemState(item: QueueItem): QueueItemState {
    return stateForKey(queueItemKey(item));
}

function conflictFor(item: QueueItem, excludingKey?: string): QueueItem | null {
    for (let i = 0; i < items.length; i++) {
        const existing = items[i];
        const key = queueItemKey(existing);
        if (key === excludingKey) continue;
        if (stateForKey(key).status === "cancelled") continue;
        if (operationsConflict(item, existing)) return existing;
    }
    return null;
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
    return addToQueueDetailed(item).kind === "added";
}

export function addToQueueDetailed(item: QueueItem): QueueAddResult {
    const existingKey = getQueuedItemKey(item);
    if (existingKey !== null) return { kind: "duplicate", key: existingKey };
    for (let i = 0; i < items.length; i++) {
        const existing = items[i];
        if (
            stateForKey(queueItemKey(existing)).status !== "cancelled" &&
            sameOperationOverlap(item, existing)
        ) {
            return { kind: "duplicate", key: queueItemKey(existing) };
        }
    }
    const key = queueItemKey(item);
    const conflict = conflictFor(item);
    items = items.concat([item]);
    if (conflict !== null) {
        const conflictingKey = queueItemKey(conflict);
        const error = `${operationLabel(item)} conflicts with queued ${operationLabel(conflict)} work for ${item.label}.`;
        itemStates.set(key, { status: "blocked", error });
        itemsRevision++;
        queueChanged();
        return { kind: "blocked", key, conflictingKey, error };
    }
    itemStates.set(key, { status: "queued", error: null });
    itemsRevision++;
    queueChanged();
    return { kind: "added", key };
}

/**
 * Sync Auto-Track's part of the queue with its latest detected work. When
 * detection is incomplete, callers can keep stale rows until a later refresh
 * confirms whether they are still needed. Manually queued rows are never
 * claimed or removed, and active-session rows stay until the task releases them.
 */
export function reconcileAutoTrackedQueue(
    desiredItems: readonly ImportQueueItem[],
    removeStale = true
): ReadonlySet<string> {
    const desiredKeys = new Set<string>();
    for (const item of desiredItems) desiredKeys.add(queueItemKey(item));

    const beforeLen = items.length;
    if (removeStale) {
        items = items.filter((item) => {
            const key = queueItemKey(item);
            if (!autoTrackedKeys.has(key) || desiredKeys.has(key)) return true;
            if (sessionKeys !== null && sessionKeys.has(key)) return true;
            autoTrackedKeys.delete(key);
            return false;
        });
    }
    if (items.length !== beforeLen) {
        itemsRevision++;
        queueChanged();
    }

    const addedKeys = new Set<string>();
    for (const item of desiredItems) {
        const key = queueItemKey(item);
        // Auto-Track has independently confirmed this row is real work, which
        // is exactly the evidence a restored row was waiting for. Hand it over
        // to Auto-Track's ownership so watch mode may act on it.
        if (restoredKeys.has(key)) {
            restoredKeys.delete(key);
            autoTrackedKeys.add(key);
        }
        if (!addToQueue(item)) continue;
        autoTrackedKeys.add(key);
        addedKeys.add(key);
    }
    return addedKeys;
}

// ── Workspace capture / restore ────────────────────────────────────────

/**
 * The queue rows worth saving: everything the user put there by hand.
 * Auto-tracked rows are omitted because `reconcileAutoTrackedQueue`
 * regenerates them from disk state on the next pass — saving them would
 * reintroduce rows that are stale by definition.
 */
export function captureQueueItems(): QueueItem[] {
    const out: QueueItem[] = [];
    for (let i = 0; i < items.length; i++) {
        if (autoTrackedKeys.has(queueItemKey(items[i]))) continue;
        out.push(items[i]);
    }
    return out;
}

/**
 * Restore saved rows. They join the queue as ordinary pending work — never as
 * session items, because the import session they may have belonged to died
 * with the reload.
 */
export function restoreQueueItems(saved: readonly QueueItem[]): void {
    for (let i = 0; i < saved.length; i++) {
        if (!addToQueue(saved[i])) continue;
        restoredKeys.add(queueItemKey(saved[i]));
    }
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
    itemStates.delete(key);
    itemsRevision++;
    if (items.length !== beforeLen) {
        autoTrackedKeys.delete(key);
        restoredKeys.delete(key);
        queueChanged();
    }
}

export function removeFromQueue(item: QueueItem): void {
    const index = queuedItemIndex(item);
    if (index < 0) return;
    const key = queueItemKey(items[index]);
    autoTrackedKeys.delete(key);
    restoredKeys.delete(key);
    items = items.slice(0, index).concat(items.slice(index + 1));
    itemStates.delete(key);
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
    if (items.length === 0 && sessionKeys === null) {
        autoTrackedKeys.clear();
        restoredKeys.clear();
        return;
    }
    items = [];
    itemStates.clear();
    itemsRevision++;
    sessionKeys = null;
    autoTrackedKeys.clear();
    restoredKeys.clear();
    queueChanged();
}

export function cancelQueueItem(key: string): boolean {
    for (let i = 0; i < items.length; i++) {
        if (queueItemKey(items[i]) !== key) continue;
        const current = stateForKey(key);
        if (current.status === "cancelled" || current.status === "running") return false;
        itemStates.set(key, { status: "cancelled", error: null });
        queueChanged();
        return true;
    }
    return false;
}

export function retryQueueItem(key: string): boolean {
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (queueItemKey(item) !== key) continue;
        const state = stateForKey(key);
        if (
            state.status !== "blocked" &&
            state.status !== "failed" &&
            state.status !== "cancelled"
        ) {
            return false;
        }
        const conflict = conflictFor(item, key);
        if (conflict !== null) {
            const error = `${operationLabel(item)} conflicts with queued ${operationLabel(conflict)} work for ${item.label}.`;
            itemStates.set(key, { status: "blocked", error });
            queueChanged();
            return false;
        }
        itemStates.set(key, { status: "queued", error: null });
        queueChanged();
        return true;
    }
    return false;
}

function nextQueuedItem(): QueueItem | null {
    for (let i = 0; i < items.length; i++) {
        const status = stateForKey(queueItemKey(items[i])).status;
        if (status === "queued") return items[i];
        if (status !== "running") return null;
    }
    return null;
}

let processing: Promise<void> | null = null;

export function isQueueProcessing(): boolean {
    return processing !== null;
}

export function processQueue(
    execute: (item: QueueItem) => Promise<QueueExecutionResult>
): Promise<void> {
    if (processing !== null) return processing;
    processing = (async () => {
        try {
            let item = nextQueuedItem();
            while (item !== null) {
                const key = queueItemKey(item);
                itemStates.set(key, { status: "running", error: null });
                queueChanged();
                let result: QueueExecutionResult;
                try {
                    result = await execute(item);
                } catch (error) {
                    result = { kind: "failed", error: String(error) };
                }
                if (result.kind === "success") {
                    removeFromQueueKey(key);
                    item = nextQueuedItem();
                    continue;
                }
                itemStates.set(
                    key,
                    result.kind === "failed"
                        ? { status: "failed", error: result.error }
                        : { status: "cancelled", error: null }
                );
                queueChanged();
                return;
            }
        } finally {
            processing = null;
        }
    })();
    return processing;
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
 * Preserve FIFO order. Import sessions still order their own resolved
 * dependencies internally; the operation queue must not move later work
 * ahead of a different operation.
 */
function sortedQueueForDisplay(queue: readonly QueueItem[]): QueueItem[] {
    return queue.slice();
}

// ── Path-based helpers ─────────────────────────────────────────────────

/**
 * Build queue items for importables whose source file matches `filePath`.
 * import.json files are deliberately not returned as a single bulk item; UI
 * rows that want "everything under this import.json" add those importables
 * individually so queue rows stay concrete.
 */
export function queueItemsForPath(
    filePath: string,
    importJsonPath?: string | null
): QueueItem[] {
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
function findImportableQueueItems(
    target: string,
    importJsonPath?: string | null
): QueueItem[] {
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
    label: string = identity,
    all = false
): ExportQueueItem {
    return {
        operation,
        kind: "importable",
        destinationPath: canonicalPath(destinationPath),
        housingUuid,
        identity,
        all,
        type,
        label,
    };
}
