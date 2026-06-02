import type { CacheState } from "../importCache/status";
import { findCacheRowIndex } from "../importCache/status";
import { importableIdentity } from "../importCache/paths";
import { getKnowledgeRows } from "./state";
import { findFileTarget } from "./state/sourceDiff";
import type { Importable } from "htsw/types";

export const STATUS_COLOR: { [k in CacheState]: number } = {
    current: 0xff5cb85c | 0,   // green
    modified: 0xffe5bc4b | 0,  // yellow
    unknown: 0xffe85c5c | 0,   // red
};

export const STATUS_LABEL: { [k in CacheState]: string } = {
    current: "current",
    modified: "modified",
    unknown: "unknown",
};

/**
 * The cache state for an importable, or `null` when no knowledge row has
 * been built for it yet. Callers that paint a dot must distinguish the two:
 * a genuine `"unknown"` (cache doesn't recognise it) is red, but "no row
 * yet" (mid-rebuild, or before the first build) is NOT — painting it red
 * makes the whole list flash red whenever rows are catching up. The
 * Knowledge pane sidesteps this by only rendering rows that exist; the
 * Importables pane renders every importable, so it must check for null.
 */
export function knowledgeStateForImportable(importable: Importable): CacheState | null {
    const rows = getKnowledgeRows();
    const idx = findCacheRowIndex(rows, importableIdentity(importable), importable.type);
    return idx === -1 ? null : rows[idx].state;
}

export function statusForImportable(importable: Importable): CacheState {
    return knowledgeStateForImportable(importable) ?? "unknown";
}

export function statusForFile(filePath: string): CacheState | null {
    const target = findFileTarget(filePath);
    if (target === null) return null;
    return statusForImportable(target.importable);
}
