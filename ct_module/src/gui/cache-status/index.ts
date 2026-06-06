import type { CacheState } from "../../importCache/status";
import { buildCacheStatusRow } from "../../importCache/status";
import { getHousingUuid } from "../state/housing";
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

// State is a pure function of (importable, knowledge cache), computed from the
// importable the caller already holds. The hash is memoized and the cache read
// hits an in-memory mirror, so this is cheap enough to run per row per frame —
// no precomputed list to drift out of sync with the importables the tree shows.
export function cacheStateForImportable(importable: Importable): CacheState | null {
    const uuid = getHousingUuid();
    if (uuid === null) return null;
    return buildCacheStatusRow(uuid, importable).state;
}

export function statusForImportable(importable: Importable): CacheState {
    return cacheStateForImportable(importable) ?? "unknown";
}

export function statusForFile(filePath: string): CacheState | null {
    const target = findFileTarget(filePath);
    if (target === null) return null;
    return statusForImportable(target.importable);
}
