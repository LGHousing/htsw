import type { KnowledgeState, KnowledgeStatusRow } from "../knowledge/status";
import { buildKnowledgeStatusRows } from "../knowledge/status";
import { importableIdentity } from "../knowledge/paths";
import { buildKnowledgeTrustPlan, trustPlanKey } from "../knowledge/trust";
import { getKnowledgeRows } from "./state";
import type { Importable } from "htsw/types";

export const STATUS_COLOR: { [k in KnowledgeState]: number } = {
    current: 0xff5cb85c | 0,   // green
    modified: 0xffe5bc4b | 0,  // yellow
    unknown: 0xffe85c5c | 0,   // red
};

export const STATUS_LABEL: { [k in KnowledgeState]: string } = {
    current: "current",
    modified: "modified",
    unknown: "unknown",
};

/** Plan-style three-state classification used for the per-row badge. */
export type PlanStatus = "current" | "diff" | "unknown";

export const PLAN_STATUS_COLOR: { [k in PlanStatus]: number } = {
    current: 0xff5cb85c | 0,
    diff: 0xffe5bc4b | 0,
    unknown: 0xffe85c5c | 0,
};

export function statusForImportable(importable: Importable): KnowledgeState {
    const rows = getKnowledgeRows();
    const id = importableIdentity(importable);
    for (let i = 0; i < rows.length; i++) {
        const row: KnowledgeStatusRow = rows[i];
        if (row.identity === id && row.importable.type === importable.type) {
            return row.state;
        }
    }
    return "unknown";
}

/**
 * Compute a `Map<importable-key, "current" | "diff" | "unknown">` for every
 * importable in the parsed list, scoped by housing UUID.
 *
 *   - "current" — knowledge cache hash matches the parsed importable
 *   - "diff"    — cache exists but the hash is different
 *   - "unknown" — no cache entry yet
 *
 * The plan calls for this exact shape for badging the LeftRail rows. Keys
 * are `${type}:${identity}` so callers can address rows without the actual
 * Importable reference.
 */
export function knowledgeStatusByImportable(
    housingUuid: string,
    importables: readonly Importable[]
): Map<string, PlanStatus> {
    const out = new Map<string, PlanStatus>();
    if (importables.length === 0) return out;
    const rows = buildKnowledgeStatusRows(housingUuid, importables);
    const plan = buildKnowledgeTrustPlan(housingUuid, importables);
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const key = trustPlanKey(row.importable.type, row.identity);
        const trusted = plan.importables.get(key)?.wholeImportableTrusted === true;
        const status: PlanStatus =
            row.state === "current" || trusted
                ? "current"
                : row.entry === null
                  ? "unknown"
                  : "diff";
        out.set(key, status);
    }
    return out;
}
