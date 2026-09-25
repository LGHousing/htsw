import type { Importable } from "htsw/types";

import type { PruneMethod, PrunableType } from "./registry";

/** One house object the manifest does not declare. */
export type PruneTarget = {
    type: PrunableType;
    identity: string;
    /** Display label; the identity itself for every type but NPC. */
    label: string;
    method: PruneMethod;
    /** House.lock records it, so a previous import of this project created it. */
    owned: boolean;
};

export type PrunePlan = {
    /** Objects to remove, in scan order. */
    targets: PruneTarget[];
    /** Types whose scan failed, so the plan is known to be incomplete. */
    scanFailures: { type: Importable["type"]; reason: string }[];
};

export function emptyPrunePlan(): PrunePlan {
    return { targets: [], scanFailures: [] };
}

export function ownedTargets(plan: PrunePlan): PruneTarget[] {
    return plan.targets.filter((target) => target.owned);
}

export function unownedTargets(plan: PrunePlan): PruneTarget[] {
    return plan.targets.filter((target) => !target.owned);
}
