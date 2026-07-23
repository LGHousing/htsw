import { describe, expect, it } from "vitest";

import {
    deriveCacheReportCounts,
    formatCacheReportSummary,
    type CacheReportRow,
} from "../src/slashCommands/cacheReportModel";
import type { ItemDependencyIndex } from "../src/importables/items/dependencyIndex";

const itemDependencies = {} as ItemDependencyIndex;

function row(
    state: CacheReportRow["state"],
    reason: CacheReportRow["reason"],
    overrides: Partial<CacheReportRow> = {}
): CacheReportRow {
    return {
        identity: "Debug",
        type: "FUNCTION",
        state,
        reason,
        entryPresent: state !== "distrusted",
        presenceOnly: reason === "presence-only",
        sourceMatchesCache: state === "trusted",
        trustedChildListCount: state === "partial" ? 1 : 0,
        dependenciesMatch: reason !== "item-dependencies",
        itemBlobAvailable: reason !== "interact-data",
        cacheMatchesLock: reason !== "lock-conflict",
        ...overrides,
    };
}

describe("cache trust report", () => {
    it("buckets presence-only records separately from missing cache entries", () => {
        const rows = [
            row("trusted", null),
            row("partial", null),
            row("distrusted", "presence-only"),
            row("distrusted", "no-cache-entry"),
            row("distrusted", "item-dependencies"),
            row("distrusted", "interact-data"),
            row("distrusted", "lock-conflict"),
            row("distrusted", "source-changed"),
        ];

        const counts = deriveCacheReportCounts(
            rows,
            [],
            itemDependencies,
            "house",
            2
        );

        expect(counts).toMatchObject({
            total: 8,
            trusted: 1,
            partial: 1,
            autoAddedItems: 2,
            distrusted: {
                "presence-only": 1,
                "no-cache-entry": 1,
                "item-dependencies": 1,
                "interact-data": 1,
                "lock-conflict": 1,
                "source-changed": 1,
            },
        });
    });

    it("formats a fixed-size summary", () => {
        const counts = deriveCacheReportCounts(
            [row("distrusted", "no-cache-entry")],
            [],
            itemDependencies,
            "house",
            0
        );

        const lines = formatCacheReportSummary(
            counts,
            "./htsw/cache-reports/cache-report-example.txt"
        );

        expect(lines).toHaveLength(7);
        expect(lines[1]).toBe(
            "&7Importables: &f1 &7total · &a0 whole-trusted · &e0 partial"
        );
        expect(lines[6]).toBe(
            "&7Details: &f./htsw/cache-reports/cache-report-example.txt"
        );
    });
});
