/**
 * Local import cache — last-known canonical state of a Housing's
 * importables, written after every successful importer sync and after
 * every exporter run. Trust mode uses this cache to skip
 * GUI reads when the on-disk source still matches the cached state.
 *
 * This module is intentionally side-effect-free at import time.
 */

export {
    writeImportableCache,
    tryWriteImportableCache,
    readImportableCache,
    deleteImportableCache,
} from "./cache";

export {
    importableHash,
    clickActionsHash,
} from "./hash";

export {
    importableIdentity,
    importableKey,
    itemSnbtCachePath,
    interactDataCachePath,
} from "./paths";

export { getCurrentHousingUuid } from "./housingId";

export { buildCacheStatusRows } from "./status";

export { readCachedActionList } from "./actionLists";

export { buildTrustPlan } from "./trust";
export type { ImportableTrustPlan, TrustPlan } from "./trust";
