/**
 * Local knowledge cache — last-known canonical state of a Housing's
 * importables, written after every successful importer sync and after
 * every exporter run. Future trust-mode will use this cache to skip
 * GUI reads when the on-disk source still matches the cached state.
 *
 * This module is intentionally side-effect-free at import time.
 */

export {
    KNOWLEDGE_SCHEMA_VERSION,
    buildKnowledgeEntry,
    writeKnowledge,
    readKnowledge,
    deleteKnowledge,
} from "./cache";
export type { KnowledgeEntry, KnowledgeWriter } from "./cache";

export {
    actionHash,
    actionListHash,
    conditionHash,
    conditionListHash,
    importableHash,
    listHashes,
    perSlotActionHashes,
} from "./hash";

export {
    cachePathFor,
    cachePathForId,
    importableIdentity,
    slug,
    KNOWLEDGE_ROOT,
} from "./paths";

export { getCurrentHousingUuid } from "./housingId";

export {
    buildKnowledgeStatusRows,
    sameHashList,
} from "./status";
export type {
    KnowledgeState,
    KnowledgeStatusRow,
} from "./status";

export {
    buildKnowledgeTrustPlan,
    trustPlanKey,
} from "./trust";
export type {
    KnowledgeTrustPlan,
    ImportableTrustPlan,
    TrustedListPath,
} from "./trust";
