/// <reference types="../../../CTAutocomplete" />

import type { Importable } from "htsw/types";

import {
    canonicalPath,
    forEachCachedParse,
    getParseAt,
} from "./parses";
import { importableSourcePath } from "./importablePaths";
import { importableIdentity } from "../../importCache/paths";

/**
 * Dynamic import queue. Replaces the old `selectedImportableIds: Set<string>`
 * which only worked against a single "active" import.json.
 *
 * A queue item is either:
 *   - `importable` — one specific importable from a parsed import.json,
 *     or
 *   - `importJson` — every importable in that import.json (expanded at
 *     import time).
 *
 * Both carry the canonical absolute path of their source import.json so
 * `startImport()` can group items back into per-import.json batches and
 * resolve each `identity` to the live `Importable` object via the parse
 * cache.
 */

export type QueueItem =
    | {
          kind: "importable";
          /** Canonical absolute path of the declaring import.json. */
          sourcePath: string;
          identity: string;
          type: Importable["type"];
          /** Display label (importable name / event constant). */
          label: string;
      }
    | {
          kind: "importJson";
          /** Canonical absolute path of the import.json itself. */
          sourcePath: string;
          /** Display label (typically the import.json's basename). */
          label: string;
      };

/** Stable identity string for a queue item. Used for set membership / removal. */
export function queueItemKey(item: QueueItem): string {
    if (item.kind === "importable") {
        return `imp:${item.sourcePath}|${item.type}:${item.identity}`;
    }
    return `json:${item.sourcePath}`;
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
}

/**
 * End the active queue session. When `removeSessionItems` is true (a fully
 * successful run) the session items are dropped from the queue, leaving
 * only pending adds. When false (cancel / failure) the items stay so the
 * user can retry; only the session marking is cleared.
 */
export function endQueueSession(removeSessionItems: boolean): void {
    if (sessionKeys !== null && removeSessionItems) {
        const keys = sessionKeys;
        items = items.filter((i) => !keys.has(queueItemKey(i)));
    }
    sessionKeys = null;
}

export function hasQueueSession(): boolean {
    return sessionKeys !== null;
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
    return true;
}

export function removeFromQueueKey(key: string): void {
    items = items.filter((i) => queueItemKey(i) !== key);
}
/** Toggle membership. Returns the *new* state (true = now in the queue). */
export function toggleQueue(item: QueueItem): boolean {
    const key = queueItemKey(item);
    if (isInQueue(key)) {
        removeFromQueueKey(key);
        return false;
    }
    items = items.concat([item]);
    return true;
}

export function clearQueue(): void {
    items = [];
    sessionKeys = null;
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
export function sortedQueueForDisplay(queue: readonly QueueItem[]): QueueItem[] {
    const itemImportables: QueueItem[] = [];
    const rest: QueueItem[] = [];
    for (const item of queue) {
        if (item.kind === "importable" && item.type === "ITEM") {
            itemImportables.push(item);
        } else {
            rest.push(item);
        }
    }
    return itemImportables.concat(rest);
}

// ── Path-based helpers ─────────────────────────────────────────────────

/**
 * Build a `QueueItem` for `filePath`. Returns null when nothing in any
 * cached parse references the path. Resolution rules:
 *   - If `filePath` itself is a parsed import.json → "importJson" item.
 *   - Otherwise scan every cached parse for an importable whose source
 *     path matches; the first match becomes an "importable" item.
 *     Multi-match files (one htsl referenced by several importables)
 *     just take the first — callers wanting all matches should iterate
 *     `queueItemsForPath` instead.
 */
export function queueItemsForPath(filePath: string): QueueItem[] {
    const target = canonicalPath(filePath);

    // Match 1: target is a parsed import.json → bulk item.
    const directParse = getParseAt(target);
    if (directParse !== null && directParse.parsed !== null) {
        const out: QueueItem[] = [
            { kind: "importJson", sourcePath: target, label: basename(target) },
        ];
        return out;
    }

    // Match 2: an importable inside any cached parse references this path.
    return findImportableQueueItems(target);
}

function basename(p: string): string {
    const slash = p.lastIndexOf("/");
    return slash < 0 ? p : p.substring(slash + 1);
}

/**
 * Locate every importable across every cached parse whose source file
 * matches `target` (canonical). Returns one queue item per match.
 */
function findImportableQueueItems(target: string): QueueItem[] {
    const out: QueueItem[] = [];
    forEachCachedParse((entry) => {
        if (entry.parsed === null) return;
        for (const imp of entry.parsed.value) {
            const src = importableSourcePath(imp, entry.parsed);
            if (src === undefined) continue;
            if (canonicalPath(src) !== target) continue;
            out.push({
                kind: "importable",
                sourcePath: entry.canonicalPath,
                identity: importableIdentity(imp),
                type: imp.type,
                label: importableLabel(imp),
            });
        }
    });
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
): QueueItem {
    return {
        kind: "importable",
        sourcePath: canonicalPath(declaringImportJson),
        identity: importableIdentity(imp),
        type: imp.type,
        label: importableLabel(imp),
    };
}
