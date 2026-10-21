import { Diagnostic, parseImportablesResult, SourceMap } from "htsw";

import { runHousingSyncTask } from "@htsw/importer/housingSync/taskRunner";
import { emitBridgeEvent } from "@htsw/importer/bridge/status";
import { expandImportDependencies } from "@htsw/importer/importables/import/dependencyExpansion";
import { peekImportableCache } from "@htsw/importer/importCache/cache";
import { getCurrentHousingUuid } from "@htsw/importer/importCache/housingId";
import { buildTrustPlan } from "@htsw/importer/importCache/trust";
import { canonicalPath } from "@htsw/importer/runtime/parsing/parses";
import { resolveModuleRelativePath } from "@htsw/importer/project/paths";
import { TaskManager } from "@htsw/importer/tasks/manager";
import { printDiagnostic, printDiagnostics } from "@htsw/importer/tui/diagnostics";
import { ensureParentDirs } from "../utils/filesystem";
import { FileSystemFileLoader } from "../utils/fileLoaders";
import { blockingDiagnostics, stripSurroundingQuotes } from "@htsw/importer/utils/helpers";
import {
    buildCacheReportRows,
    deriveCacheReportCounts,
    formatCacheReportDetail,
    formatCacheReportSummary,
} from "./cacheReportModel";

export function commandCacheReport(args: string[]): void {
    if (args.length === 0) {
        ChatLib.chat("&cUsage: /htsw cache <import.json>");
        return;
    }
    if (TaskManager.isBusy()) {
        ChatLib.chat("&c[htsw] Another Housing task is already running.");
        return;
    }

    const resolved = resolveModuleRelativePath(stripSurroundingQuotes(args.join(" ")));
    if (!FileLib.exists(resolved)) {
        ChatLib.chat(`&cFile does not exist '${resolved}'`);
        return;
    }
    const importJsonPath = canonicalPath(resolved);

    const sourceMap = new SourceMap(new FileSystemFileLoader());
    const parsed = parseImportablesResult(sourceMap, importJsonPath);
    printDiagnostics(sourceMap, parsed.diagnostics);
    const blocking = blockingDiagnostics(parsed.diagnostics);
    if (blocking.length > 0) {
        printDiagnostic(
            sourceMap,
            Diagnostic.error(
                `Cache report failed with ${blocking.length} error${blocking.length === 1 ? "" : "s"}`
            )
        );
        return;
    }

    runHousingSyncTask(
        "import",
        async (ctx) => {
            const housingUuid = await getCurrentHousingUuid(ctx);
            const expansion = expandImportDependencies(parsed, parsed.value, housingUuid);
            const trustPlan = buildTrustPlan(
                housingUuid,
                expansion.importables,
                true,
                importJsonPath,
                expansion.itemDependencies
            );
            const rows = buildCacheReportRows(trustPlan, (row) =>
                peekImportableCache(housingUuid, row.importable.type, row.identity)
            );
            const counts = deriveCacheReportCounts(
                rows,
                expansion.importables,
                expansion.itemDependencies,
                housingUuid,
                expansion.addedItems.length
            );
            const detailPath = writeCacheReport(rows);
            emitBridgeEvent("htsw_cache_report", {
                status: "completed",
                ...counts,
                path: detailPath,
            });
            for (const line of formatCacheReportSummary(counts, detailPath)) {
                ChatLib.chat(line);
            }
        },
        { disabled: true }
    ).catch((error: unknown) => {
        emitBridgeEvent("htsw_cache_report", { status: "failed", reason: String(error) });
        ChatLib.chat(`&c[htsw] Cache report failed: ${String(error)}`);
    });
}

function writeCacheReport(rows: ReturnType<typeof buildCacheReportRows>): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const path = `./htsw/cache-reports/cache-report-${timestamp}.txt`;
    const lines = rows.map(formatCacheReportDetail);
    ensureParentDirs(path);
    FileLib.write(path, lines.join("\n"), true);
    return path;
}
