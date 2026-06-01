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
    readImportableCache,
    deleteImportableCache,
} from "./cache";

export {
    importableHash,
} from "./hash";

export {
    importableIdentity,
    importableKey,
    itemSnbtCachePath,
} from "./paths";

export { getCurrentHousingUuid } from "./housingId";

export { buildCacheStatusRows } from "./status";

export { buildTrustPlan } from "./trust";
export type { ImportableTrustPlan } from "./trust";
