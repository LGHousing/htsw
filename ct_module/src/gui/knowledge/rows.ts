import type { Importable } from "htsw/types";

import type { CacheStatusRow } from "../../importCache/status";
import { buildCacheStatusRows, findCacheRowIndex } from "../../importCache/status";
import { importableHash } from "../../importCache/hash";
import { importableIdentity } from "../../importCache/paths";

let knowledgeRows: CacheStatusRow[] = [];

export function getKnowledgeRows(): CacheStatusRow[] {
    return knowledgeRows;
}
export function setKnowledgeRows(rows: CacheStatusRow[]): void {
    knowledgeRows = rows;
}
export function appendKnowledgeRows(rows: CacheStatusRow[]): void {
    if (rows.length === 0) return;
    knowledgeRows = knowledgeRows.concat(rows);
}

/**
 * Recompute the hash + state for the knowledge row matching this
 * importable. Use after an in-place mutation so the diff dots stay
 * accurate without rebuilding every row.
 */
export function refreshKnowledgeRowFor(imp: Importable): void {
    const idx = findCacheRowIndex(knowledgeRows, importableIdentity(imp), imp.type);
    if (idx === -1) return;
    const row = knowledgeRows[idx];
    const newHash = importableHash(imp);
    row.importable = imp;
    row.hash = newHash;
    row.state = row.entry === null
        ? "unknown"
        : row.entry.hash === newHash ? "current" : "modified";
}

/**
 * Re-read ONE importable's cache from disk and upsert its knowledge row.
 * Unlike `refreshKnowledgeRowFor` (which reuses the row's stale `entry`), this
 * picks up a freshly-written cache file — so a dot turns green the instant its
 * import finishes, without rebuilding all rows through the batched full refresh.
 */
export function refreshKnowledgeRowFromDisk(housingUuid: string, imp: Importable): void {
    const built = buildCacheStatusRows(housingUuid, [imp]);
    if (built.length === 0) return;
    const newRow = built[0];
    const idx = findCacheRowIndex(knowledgeRows, newRow.identity, newRow.importable.type);
    if (idx === -1) knowledgeRows.push(newRow);
    else knowledgeRows[idx] = newRow;
}
