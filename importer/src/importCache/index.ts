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
    loadImportableCachesOffThread,
} from "./cache";
export type { ImportableCacheLoadRequest } from "./cache";
export { importableHash } from "./hash";

export { getCurrentHousingUuid } from "./housingId";

export { buildTrustPlan } from "./trust";
export type { ImportableTrustPlan, TrustPlan } from "./trust";
