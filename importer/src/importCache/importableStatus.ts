import type { Importable } from "htsw/types";
import type { CacheState } from "./status";
import { buildCacheStatusRow, buildCacheStatusRowFromEntry } from "./status";
import { getHousingUuid } from "../runtime/state/housing";
import { importableIdentity } from "../importables/identity";
import { peekImportableCache } from "./cache";
import { requestImportableCacheWarm } from "./cacheWarm";

// State is a pure function of (importable, knowledge cache), computed from the
// importable the caller already holds. The hash is memoized and the cache read
// hits an in-memory mirror, so this is cheap enough to run per row per frame —
// no precomputed list to drift out of sync with the importables the tree shows.
function cacheStateForImportable(importable: Importable): CacheState | null {
    const uuid = getHousingUuid();
    if (uuid === null) return null;
    return buildCacheStatusRow(uuid, importable).state;
}

function statusForImportable(importable: Importable): CacheState {
    return cacheStateForImportable(importable) ?? "unknown";
}

export function statusForImportableBlocking(
    importable: Importable
): CacheState {
    return statusForImportable(importable);
}

export function cachedStatusForImportable(
    importable: Importable
): CacheState | null {
    const uuid = getHousingUuid();
    if (uuid === null) return "unknown";
    const cached = peekImportableCache(
        uuid,
        importable.type,
        importableIdentity(importable)
    );
    if (!cached.loaded) {
        requestImportableCacheWarm(uuid, importable);
        return null;
    }
    return buildCacheStatusRowFromEntry(importable, cached.entry).state;
}
