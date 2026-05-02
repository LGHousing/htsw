import { exportImportable } from "../importables/exports";
import { importSelectedImportables, type ImportProgress } from "../importables/importSession";
import { canonicalSlug, defaultExportRoot } from "../exporter/paths";
import { startProgressOverlay, stopProgressOverlay, updateProgress } from "./progressOverlay";
import {
    buildKnowledgeTrustPlan,
    deleteKnowledge,
    getCurrentHousingUuid,
    importableIdentity,
    trustPlanKey,
} from "../knowledge";
import { TaskManager } from "../tasks/manager";
import { stripSurroundingQuotes } from "../utils/strings";

import { rememberImportPath, writeGuiConfig } from "./config";
import { resolveHtswHomePath } from "./files";
import {
    diagnosticSummary,
    isBlockingDiagnostic,
    isImportableSupported,
    loadImportProject,
    rowsFromImportables,
    type DashboardRow,
} from "./model";
import type { DashboardRuntime } from "./dashboardRuntime";
import { trimText } from "./widgets";

export function loadPath(runtime: DashboardRuntime, rawPath: string): void {
    const path = resolveHtswHomePath(
        stripSurroundingQuotes(rawPath.trim() || "import.json")
    );
    runtime.state.importPath = path;
    runtime.state.parseStatus = { kind: "loading" };
    runtime.project = loadImportProject(path);
    runtime.state.diagnostics =
        runtime.project.kind === "ready"
            ? runtime.project.diagnostics
            : (runtime.project.diagnostics ?? []);

    if (runtime.project.kind === "ready") {
        runtime.state.parseStatus = { kind: "ready" };
        runtime.state.rows = rowsFromImportables(
            runtime.state.housingUuid,
            runtime.project.importables,
            runtime.state.rows
        );
        runtime.config = rememberImportPath(runtime.config, path);
        writeGuiConfig(runtime.config);
        runtime.state.statusMessage = `Loaded ${runtime.project.importables.length} importables.`;
    } else {
        runtime.state.parseStatus = { kind: "error", message: runtime.project.message };
        runtime.state.rows = [];
        const firstDiagnostic = runtime.state.diagnostics.find(isBlockingDiagnostic);
        runtime.state.statusMessage = firstDiagnostic
            ? trimText(diagnosticSummary(firstDiagnostic), 120)
            : `Load failed: ${runtime.project.message}`;
    }
}

export function resolveHousing(runtime: DashboardRuntime): void {
    TaskManager.run(async (ctx) => {
        const uuid = await getCurrentHousingUuid(ctx);
        runtime.state.housingUuid = uuid;
        runtime.state.houseAlias = runtime.config.houseAliases[uuid] ?? null;
        if (runtime.state.exportRoot.length === 0) {
            runtime.state.exportRoot = defaultExportRoot(uuid);
        }
        if (runtime.project?.kind === "ready") {
            runtime.state.rows = rowsFromImportables(
                uuid,
                runtime.project.importables,
                runtime.state.rows
            );
        }
    }).catch((error) => {
        runtime.state.statusMessage = `No housing UUID: ${error}`;
    });
}

export function startImport(runtime: DashboardRuntime, rows: DashboardRow[]): void {
    const housingUuid = runtime.state.housingUuid;
    if (housingUuid === null || rows.length === 0 || runtime.state.activeTask !== null)
        return;
    const supported = rows.filter((row) => isImportableSupported(row.importable));
    if (supported.length === 0) return;

    runtime.state.activeTask = { kind: "import", label: `Importing ${supported.length}` };
    const importables = supported.map((row) => row.importable);
    const sourcePath = runtime.state.importPath;
    const trustMode = runtime.state.trustModeEnabled;
    if (trustMode && runtime.project?.kind === "ready") {
        const trustPlan = buildKnowledgeTrustPlan(
            housingUuid,
            runtime.project.importables
        );
        let whole = 0;
        let nested = 0;
        for (const importable of importables) {
            const key = trustPlanKey(importable.type, importableIdentity(importable));
            const plan = trustPlan.importables.get(key);
            if (plan?.wholeImportableTrusted) whole++;
            nested += plan?.trustedListPaths.size ?? 0;
        }
        ChatLib.chat(
            `&7[gui] trust preview: ${whole} whole importable(s), ${nested} trusted list path(s).`
        );
    }
    runtime.gui.close();
    startProgressOverlay(runtime, `Importing ${importables.length}`);
    TaskManager.run(async (ctx) => {
        ctx.displayMessage(
            `&a[gui] Importing ${importables.length} importable(s)${trustMode ? " with trust mode" : ""}.`
        );
        const result = await importSelectedImportables(ctx, {
            importables,
            trustMode,
            housingUuid,
            sourcePath,
            onProgress: (p: ImportProgress) => updateProgress(runtime, p),
        });
        ctx.displayMessage(
            `&a[gui] Import done: ${result.imported} imported, ${result.skippedTrusted} trusted skip, ${result.failed} failed.`
        );
        stopProgressOverlay(runtime, `Done · ${result.imported} imported, ${result.failed} failed`);
        runtime.state.activeTask = null;
    }).catch((error) => {
        ChatLib.chat(`&c[gui] Import failed: ${error}`);
        stopProgressOverlay(runtime, `Failed: ${error}`);
        runtime.state.activeTask = null;
    });
}

export function startExport(runtime: DashboardRuntime): void {
    const housingUuid = runtime.state.housingUuid;
    const name = runtime.state.exportFunctionName.trim();
    if (housingUuid === null || name.length === 0 || runtime.state.activeTask !== null)
        return;
    const rootDir = (runtime.state.exportRoot || defaultExportRoot(housingUuid)).replace(
        /[\\/]+$/,
        ""
    );
    const importJsonPath = `${rootDir}/import.json`;
    const filename = `${canonicalSlug(name)}.htsl`;

    runtime.state.activeTask = { kind: "export", label: `Exporting ${name}` };
    runtime.gui.close();
    startProgressOverlay(runtime, `Exporting ${name}`);
    updateProgress(runtime, { completed: 0, total: 1, currentLabel: name, failed: 0 });
    TaskManager.run(async (ctx) => {
        await exportImportable(ctx, {
            type: "FUNCTION",
            name,
            importJsonPath,
            htslPath: `${rootDir}/${filename}`,
            htslReference: filename,
        });
        updateProgress(runtime, { completed: 1, total: 1, currentLabel: "done", failed: 0 });
        stopProgressOverlay(runtime, `Exported ${name}.`);
        runtime.state.activeTask = null;
    }).catch((error) => {
        ChatLib.chat(`&c[gui] Export failed: ${error}`);
        stopProgressOverlay(runtime, `Export failed: ${error}`);
        runtime.state.activeTask = null;
    });
}

export function forgetRows(runtime: DashboardRuntime, rows: DashboardRow[]): void {
    const housingUuid = runtime.state.housingUuid;
    if (housingUuid === null) return;
    for (const row of rows) {
        deleteKnowledge(housingUuid, row.type, row.identity);
    }
    runtime.pendingForget = false;
    if (runtime.project?.kind === "ready") {
        runtime.state.rows = rowsFromImportables(
            housingUuid,
            runtime.project.importables,
            runtime.state.rows
        );
    }
    runtime.state.statusMessage = `Forgot ${rows.length} knowledge entr${rows.length === 1 ? "y" : "ies"}.`;
}
