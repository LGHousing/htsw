import type { Importable } from "htsw/types";

import { cacheEntryHash, type ImportableCachePeek } from "../importCache/cache";
import { importableHash } from "../importCache/hash";
import type { ImportableTrustPlan, TrustPlan } from "../importCache/trust";
import {
    hasInteractDataCache,
    hasItemClickActions,
} from "../importables/items/interactDataCache";
import type { ItemDependencyIndex } from "../importables/items/dependencyIndex";

type CacheReportReason =
    | "no-cache-entry"
    | "presence-only"
    | "item-dependencies"
    | "interact-data"
    | "lock-conflict"
    | "source-changed";

export type CacheReportRow = {
    identity: string;
    type: Importable["type"];
    state: "trusted" | "partial" | "distrusted";
    reason: CacheReportReason | null;
    entryPresent: boolean;
    presenceOnly: boolean;
    sourceMatchesCache: boolean;
    trustedChildListCount: number;
    dependenciesMatch: boolean;
    itemBlobAvailable: boolean;
    cacheMatchesLock: boolean;
};

export type CacheReportCounts = {
    total: number;
    trusted: number;
    partial: number;
    distrusted: Record<CacheReportReason, number>;
    clickActionItems: number;
    usableInteractData: number;
    autoAddedItems: number;
};

export function buildCacheReportRows(
    trustPlan: TrustPlan,
    peek: (row: ImportableTrustPlan) => ImportableCachePeek
): CacheReportRow[] {
    const rows: CacheReportRow[] = [];
    trustPlan.importables.forEach((plan) => {
        const cachePeek = peek(plan);
        const presenceOnly =
            plan.entry === null && cachePeek.loaded && cachePeek.house !== null;
        const sourceMatchesCache =
            plan.entry !== null &&
            cacheEntryHash(plan.entry) === importableHash(plan.importable);
        const partial =
            plan.entry !== null &&
            !sourceMatchesCache &&
            plan.trustedChildListPaths.size > 0;
        const reason = plan.wholeImportableTrusted
            ? null
            : distrustReason(plan, presenceOnly, partial);

        rows.push({
            identity: plan.identity,
            type: plan.importable.type,
            state: plan.wholeImportableTrusted
                ? "trusted"
                : partial
                  ? "partial"
                  : "distrusted",
            reason,
            entryPresent: plan.entry !== null,
            presenceOnly,
            sourceMatchesCache,
            trustedChildListCount: plan.trustedChildListPaths.size,
            dependenciesMatch: plan.breakdown.dependenciesMatch,
            itemBlobAvailable: plan.breakdown.itemBlobAvailable,
            cacheMatchesLock: plan.breakdown.cacheMatchesLock,
        });
    });
    return rows;
}

function distrustReason(
    plan: ImportableTrustPlan,
    presenceOnly: boolean,
    partial: boolean
): CacheReportReason | null {
    if (plan.entry === null) return presenceOnly ? "presence-only" : "no-cache-entry";
    if (!plan.breakdown.dependenciesMatch) return "item-dependencies";
    if (!plan.breakdown.itemBlobAvailable) return "interact-data";
    if (!plan.breakdown.cacheMatchesLock) return "lock-conflict";
    return partial ? null : "source-changed";
}

export function deriveCacheReportCounts(
    rows: readonly CacheReportRow[],
    importables: readonly Importable[],
    itemDependencies: ItemDependencyIndex,
    housingUuid: string,
    autoAddedItems: number
): CacheReportCounts {
    const distrusted: Record<CacheReportReason, number> = {
        "no-cache-entry": 0,
        "presence-only": 0,
        "item-dependencies": 0,
        "interact-data": 0,
        "lock-conflict": 0,
        "source-changed": 0,
    };
    let trusted = 0;
    let partial = 0;
    for (const row of rows) {
        if (row.state === "trusted") trusted++;
        else if (row.state === "partial") partial++;
        else if (row.reason !== null) distrusted[row.reason]++;
    }

    let clickActionItems = 0;
    let usableInteractData = 0;
    for (const importable of importables) {
        if (importable.type !== "ITEM" || !hasItemClickActions(importable)) continue;
        clickActionItems++;
        if (hasInteractDataCache(importable, itemDependencies, housingUuid)) {
            usableInteractData++;
        }
    }

    return {
        total: rows.length,
        trusted,
        partial,
        distrusted,
        clickActionItems,
        usableInteractData,
        autoAddedItems,
    };
}

export function formatCacheReportSummary(
    counts: CacheReportCounts,
    detailPath: string
): string[] {
    const d = counts.distrusted;
    return [
        `&e[htsw] Cache trust report`,
        `&7Importables: &f${counts.total} &7total · &a${counts.trusted} whole-trusted · &e${counts.partial} partial`,
        `&7No cache entry: &f${d["no-cache-entry"]} &7· presence-only: &f${d["presence-only"]}`,
        `&7Item metadata missing/stale: &f${d["item-dependencies"]} &7· interact_data uncached: &f${d["interact-data"]}`,
        `&7Lock conflicts: &f${d["lock-conflict"]} &7· source changed without reusable child lists: &f${d["source-changed"]}`,
        `&7Click-action items: &f${counts.clickActionItems} &7· usable interact_data: &f${counts.usableInteractData} &7· auto-added: &f${counts.autoAddedItems}`,
        `&7Details: &f${detailPath}`,
    ];
}

export function formatCacheReportDetail(row: CacheReportRow): string {
    return [
        `${row.type}:${row.identity}`,
        `state=${row.state}`,
        `reason=${row.reason ?? "none"}`,
        `entryPresent=${row.entryPresent}`,
        `presenceOnly=${row.presenceOnly}`,
        `sourceMatchesCache=${row.sourceMatchesCache}`,
        `trustedChildLists=${row.trustedChildListCount}`,
        `dependenciesMatch=${row.dependenciesMatch}`,
        `itemBlobAvailable=${row.itemBlobAvailable}`,
        `cacheMatchesLock=${row.cacheMatchesLock}`,
    ].join(" ");
}
