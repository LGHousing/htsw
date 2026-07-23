import { Diagnostic, parseImportablesResult, SourceMap } from "htsw";

import { runHousingSyncTask } from "../housingSync/taskRunner";
import { expandImportDependencies } from "../importables/import/dependencyExpansion";
import { peekImportableCache } from "../importCache/cache";
import { getCurrentHousingUuid } from "../importCache/housingId";
import { buildTrustPlan } from "../importCache/trust";
import { canonicalPath } from "../gui/parsing/parses";
import { resolveModuleRelativePath } from "../project/paths";
import { TaskManager } from "../tasks/manager";
import { printDiagnostic, printDiagnostics } from "../tui/diagnostics";
import { ensureParentDirs } from "../utils/filesystem";
import { FileSystemFileLoader } from "../utils/fileLoaders";
import { stripSurroundingQuotes } from "../utils/helpers";
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
    const blocking = parsed.diagnostics.filter(
        (diagnostic) => diagnostic.level === "error" || diagnostic.level === "bug"
    );
    if (blocking.length > 0) {
        printDiagnostic(
            sourceMap,
            Diagnostic.error(
                `Cache report failed with ${blocking.length} error${blocking.length === 1 ? "" : "s"}`
            )
        );
        return;
    }

    runHousingSyncTask("import", async (ctx) => {
        const housingUuid = await getCurrentHousingUuid(ctx);
        const expansion = expandImportDependencies(
            parsed,
            parsed.value,
            housingUuid
        );
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
        for (const line of formatCacheReportSummary(counts, detailPath)) {
            ChatLib.chat(line);
        }
    }).catch((error: unknown) => {
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
