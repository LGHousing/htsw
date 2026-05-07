/// <reference types="../../../CTAutocomplete" />

import type { Importable } from "htsw/types";

import {
    canonicalPath,
    forEachCachedParse,
    getParseAt,
    parseImportJsonAt,
} from "./parses";
import { importableSourcePath } from "./importablePaths";
import { importableIdentity } from "../../knowledge/paths";

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

export function getQueue(): readonly QueueItem[] {
    return items;
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

export function removeFromQueue(item: QueueItem): void {
    removeFromQueueKey(queueItemKey(item));
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
export function queueItemForPath(filePath: string): QueueItem | null {
    const all = queueItemsForPath(filePath);
    return all.length === 0 ? null : all[0];
}

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
 * object pulled from a known parse. Used by Explore row right-clicks
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

/**
 * Convenience: the bulk queue item for an entire import.json. Used by
 * the Explore right-click on an import.json file row.
 */
export function makeImportJsonQueueItem(importJsonPath: string): QueueItem {
    const canon = canonicalPath(importJsonPath);
    // Parse it now if we haven't yet, so size estimates / labels are
    // available immediately.
    parseImportJsonAt(importJsonPath);
    return { kind: "importJson", sourcePath: canon, label: basename(canon) };
}
