import type { Importable } from "htsw/types";

import type { CacheStatusRow } from "../../importCache/status";
import { buildCacheStatusRows, findCacheRowIndex } from "../../importCache/status";
import { importableHash } from "../../importCache/hash";
import { importableIdentity } from "../../importCache/paths";

let cacheStatusRows: CacheStatusRow[] = [];

export function getCacheStatusRows(): CacheStatusRow[] {
    return cacheStatusRows;
}
export function setCacheStatusRows(rows: CacheStatusRow[]): void {
    cacheStatusRows = rows;
}
export function appendCacheStatusRows(rows: CacheStatusRow[]): void {
    if (rows.length === 0) return;
    cacheStatusRows = cacheStatusRows.concat(rows);
}

export function refreshCacheStatusRowFor(imp: Importable): void {
    const idx = findCacheRowIndex(cacheStatusRows, importableIdentity(imp), imp.type);
    if (idx === -1) return;
    const row = cacheStatusRows[idx];
    const newHash = importableHash(imp);
    row.importable = imp;
    row.hash = newHash;
    row.state = row.entry === null
        ? "unknown"
        : row.entry.hash === newHash ? "current" : "modified";
}

export function refreshCacheStatusRowFromDisk(housingUuid: string, imp: Importable): void {
    const built = buildCacheStatusRows(housingUuid, [imp]);
    if (built.length === 0) return;
    const newRow = built[0];
    const idx = findCacheRowIndex(cacheStatusRows, newRow.identity, newRow.importable.type);
    if (idx === -1) cacheStatusRows.push(newRow);
    else cacheStatusRows[idx] = newRow;
}
