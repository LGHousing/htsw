import type { CacheState } from "../../importCache/status";
import { findCacheRowIndex } from "../../importCache/status";
import { importableIdentity } from "../../importCache/paths";
import { getCacheStatusRows } from "./rows";
import { findFileTarget } from "../code-view/sourceDiff";
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

export function cacheStateForImportable(importable: Importable): CacheState | null {
    const rows = getCacheStatusRows();
    const idx = findCacheRowIndex(rows, importableIdentity(importable), importable.type);
    return idx === -1 ? null : rows[idx].state;
}

export function statusForImportable(importable: Importable): CacheState {
    return cacheStateForImportable(importable) ?? "unknown";
}

export function statusForFile(filePath: string): CacheState | null {
    const target = findFileTarget(filePath);
    if (target === null) return null;
    return statusForImportable(target.importable);
}
