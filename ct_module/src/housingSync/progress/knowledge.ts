import type { ImportableTrustPlan } from "../../importCache";
import type { SyncEventHandler } from "../syncEvents";
import type {
    KnowledgeLockStatus,
    KnowledgeSourceKind,
    KnowledgeSourceReason,
} from "./types";

function lockStatusFor(
    plan: ImportableTrustPlan | undefined
): KnowledgeLockStatus | undefined {
    if (plan?.entry === null || plan === undefined) return undefined;
    if (plan.lockHash === null) return "missing";
    return plan.cacheMatchesLock ? "matched" : "mismatch";
}

export function emitKnowledgeSource(
    events: SyncEventHandler | undefined,
    source: KnowledgeSourceKind,
    reason: KnowledgeSourceReason,
    plan?: ImportableTrustPlan
): void {
    const lockStatus = lockStatusFor(plan);
    events?.emit({
        kind: "knowledgeSourceUsed",
        source,
        reason,
        ...(lockStatus === undefined ? {} : { lockStatus }),
    });
}
