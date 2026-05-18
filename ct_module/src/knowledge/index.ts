/**
 * Local knowledge cache — last-known canonical state of a Housing's
 * importables, written after every successful importer sync and after
 * every exporter run. Future trust-mode will use this cache to skip
 * GUI reads when the on-disk source still matches the cached state.
 *
 * This module is intentionally side-effect-free at import time.
 */

export {
    writeKnowledge,
    readKnowledge,
    deleteKnowledge,
} from "./cache";

export {
    importableHash,
} from "./hash";

export {
    importableIdentity,
    itemSnbtCachePath,
} from "./paths";

export { getCurrentHousingUuid } from "./housingId";

export { buildKnowledgeStatusRows } from "./status";

export { buildKnowledgeTrustPlan, trustPlanKey } from "./trust";
export type { ImportableTrustPlan } from "./trust";
