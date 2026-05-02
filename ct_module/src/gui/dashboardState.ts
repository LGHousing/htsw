import { writeGuiConfig, setHouseAlias } from "./config";
import { listBrowserEntries, normalizePathForDisplay } from "./files";
import { isImportableSupported, visibleRows, type DashboardRow } from "./model";
import type { DashboardRuntime } from "./dashboardRuntime";

export function refreshBrowser(runtime: DashboardRuntime): void {
    runtime.browserDir = normalizePathForDisplay(runtime.browserDir);
    runtime.browserEntries = listBrowserEntries(runtime.browserDir);
}

export function toggleRow(runtime: DashboardRuntime, id: string): void {
    runtime.state.rows = runtime.state.rows.map((row) =>
        row.id === id ? { ...row, selected: !row.selected } : row
    );
}

export function selectVisible(runtime: DashboardRuntime): void {
    const ids = new Set(visibleRows(runtime.state).map((row) => row.id));
    const allSelected = runtime.state.rows
        .filter((row) => ids.has(row.id))
        .every((row) => row.selected);
    runtime.state.rows = runtime.state.rows.map((row) =>
        ids.has(row.id) ? { ...row, selected: !allSelected } : row
    );
}

export function selectedRows(runtime: DashboardRuntime): DashboardRow[] {
    return runtime.state.rows.filter((row) => row.selected);
}

export function setPreviewRow(runtime: DashboardRuntime, id: string): void {
    runtime.state.previewRowId = id;
}

/**
 * Open (or focus) a tab for an importable row. Single-click semantics =
 * `pinned: false`, replacing the existing unpinned tab. Double-click =
 * `pinned: true`, which survives further single-click previews.
 */
export function openImportableTab(
    runtime: DashboardRuntime,
    rowId: string,
    pinned: boolean
): void {
    const id = `importable:${rowId}`;
    const row = runtime.state.rows.find((entry) => entry.id === rowId);
    const title = row !== undefined ? `${row.type}: ${row.identity}` : rowId;

    const existing = runtime.state.tabs.find((tab) => tab.id === id);
    if (existing !== undefined) {
        if (pinned) existing.pinned = true;
        runtime.state.activeTabId = id;
        runtime.state.previewRowId = rowId;
        return;
    }
    if (!pinned) {
        runtime.state.tabs = runtime.state.tabs.filter((tab) => tab.pinned);
    }
    runtime.state.tabs.push({
        id,
        kind: "importable",
        title,
        pinned,
        payload: rowId,
    });
    runtime.state.activeTabId = id;
    runtime.state.previewRowId = rowId;
}

export function openHtslTab(
    runtime: DashboardRuntime,
    rowId: string,
    pinned: boolean
): void {
    const id = `htsl:${rowId}`;
    const row = runtime.state.rows.find((entry) => entry.id === rowId);
    const title =
        row !== undefined ? `${row.identity}.htsl` : `${rowId}.htsl`;

    const existing = runtime.state.tabs.find((tab) => tab.id === id);
    if (existing !== undefined) {
        if (pinned) existing.pinned = true;
        runtime.state.activeTabId = id;
        return;
    }
    if (!pinned) {
        runtime.state.tabs = runtime.state.tabs.filter((tab) => tab.pinned);
    }
    runtime.state.tabs.push({
        id,
        kind: "htsl",
        title,
        pinned,
        payload: rowId,
    });
    runtime.state.activeTabId = id;
}

export function ensureJsonTabForActiveImport(runtime: DashboardRuntime): void {
    const existing = runtime.state.tabs.find((tab) => tab.kind === "json");
    if (existing !== undefined) {
        existing.payload = runtime.state.importPath;
        existing.pinned = true;
        return;
    }
    runtime.state.tabs.unshift({
        id: "json:active",
        kind: "json",
        title: "import.json",
        pinned: true,
        payload: runtime.state.importPath,
    });
    if (runtime.state.activeTabId === null) {
        runtime.state.activeTabId = "json:active";
    }
}

export function setActiveTab(runtime: DashboardRuntime, tabId: string): void {
    const tab = runtime.state.tabs.find((entry) => entry.id === tabId);
    if (tab === undefined) return;
    runtime.state.activeTabId = tabId;
    if (tab.kind === "importable") {
        runtime.state.previewRowId = tab.payload;
    } else if (tab.kind === "htsl") {
        runtime.state.previewRowId = tab.payload;
    }
}

export function pinTab(runtime: DashboardRuntime, tabId: string): void {
    const tab = runtime.state.tabs.find((entry) => entry.id === tabId);
    if (tab !== undefined) tab.pinned = true;
}

export function closeTab(runtime: DashboardRuntime, tabId: string): void {
    const idx = runtime.state.tabs.findIndex((entry) => entry.id === tabId);
    if (idx < 0) return;
    runtime.state.tabs.splice(idx, 1);
    if (runtime.state.activeTabId === tabId) {
        const fallback =
            runtime.state.tabs[idx] ?? runtime.state.tabs[idx - 1] ?? null;
        runtime.state.activeTabId = fallback ? fallback.id : null;
        if (fallback && (fallback.kind === "importable" || fallback.kind === "htsl")) {
            runtime.state.previewRowId = fallback.payload;
        } else {
            runtime.state.previewRowId = null;
        }
    }
}

export function modifiedOrUnknownRows(runtime: DashboardRuntime): DashboardRow[] {
    return runtime.state.rows.filter(
        (row) => row.knowledgeState !== "current" && isImportableSupported(row.importable)
    );
}

export function canMutate(runtime: DashboardRuntime): boolean {
    return runtime.state.housingUuid !== null && runtime.state.activeTask === null;
}

export function focusAlias(runtime: DashboardRuntime): void {
    if (runtime.state.housingUuid === null) return;
    runtime.focusedField = "aliasValue";
    runtime.state.statusMessage = "Type house alias and press Enter.";
}

export function commitAlias(runtime: DashboardRuntime): void {
    const uuid = runtime.state.housingUuid;
    if (uuid === null) return;
    runtime.config = setHouseAlias(runtime.config, uuid, runtime.state.houseAlias ?? "");
    writeGuiConfig(runtime.config);
    const alias = runtime.state.houseAlias?.trim() ?? "";
    runtime.state.houseAlias = alias.length > 0 ? alias : null;
    runtime.state.statusMessage =
        alias.length > 0 ? `Saved house alias: ${alias}` : "Cleared house alias.";
}

export function getFieldValue(runtime: DashboardRuntime, id: string): string {
    switch (id) {
        case "importPath":
            return runtime.state.importPath;
        case "exportName":
            return runtime.state.exportFunctionName;
        case "exportRoot":
            return runtime.state.exportRoot;
        case "browserPath":
            return runtime.browserDir;
        case "aliasValue":
            return runtime.state.houseAlias ?? "";
        case "promptValue":
            return runtime.pendingPrompt?.value ?? "";
        case "searchQuery":
            return runtime.state.searchQuery;
        default:
            return "";
    }
}

export function setFieldValue(
    runtime: DashboardRuntime,
    id: string,
    value: string
): void {
    switch (id) {
        case "importPath":
            runtime.state.importPath = value;
            break;
        case "exportName":
            runtime.state.exportFunctionName = value;
            break;
        case "exportRoot":
            runtime.state.exportRoot = value;
            break;
        case "browserPath":
            runtime.browserDir = value;
            break;
        case "aliasValue":
            runtime.state.houseAlias = value;
            break;
        case "promptValue":
            if (runtime.pendingPrompt !== null) {
                runtime.pendingPrompt.value = value;
            }
            break;
        case "searchQuery":
            runtime.state.searchQuery = value;
            break;
    }
}
