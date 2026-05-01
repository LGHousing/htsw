import { Diagnostic } from "htsw";

import { TaskManager } from "../tasks/manager";
import {
    buildKnowledgeTrustPlan,
    getCurrentHousingUuid,
    deleteKnowledge,
    importableIdentity,
    trustPlanKey,
} from "../knowledge";
import { importSelectedImportables } from "../importables/importSession";
import { exportImportable } from "../importables/exports";
import { canonicalSlug, defaultExportRoot } from "../exporter/paths";
import { stripSurroundingQuotes } from "../utils/strings";

import { Colors, stateColor } from "./colors";
import {
    defaultGuiConfig,
    readGuiConfig,
    rememberImportPath,
    setHouseAlias,
    writeGuiConfig,
    type HtswGuiConfig,
} from "./config";
import {
    directoryForPath,
    listBrowserEntries,
    normalizePathForDisplay,
    parentDirectory,
    type BrowserEntry,
} from "./files";
import {
    createInitialDashboardState,
    isImportableSupported,
    loadImportProject,
    rowsFromImportables,
    visibleRows,
    type DashboardFilter,
    type DashboardRow,
    type DashboardState,
    type LoadedProject,
} from "./model";
import {
    contains,
    drawButton,
    drawPanel,
    drawTextField,
    drawToggle,
    shortHash,
    trimText,
    type Rect,
    type TextField,
} from "./widgets";

type ClickTarget =
    | { kind: "button"; id: string; rect: Rect; enabled: boolean }
    | { kind: "row"; id: string; rect: Rect }
    | { kind: "recent"; path: string; rect: Rect }
    | { kind: "browser"; entry: BrowserEntry; rect: Rect }
    | { kind: "field"; id: string; rect: Rect };

type DashboardRuntime = {
    gui: Gui;
    state: DashboardState;
    config: HtswGuiConfig;
    project: LoadedProject | null;
    clickTargets: ClickTarget[];
    fields: TextField[];
    focusedField: string | null;
    rowScroll: number;
    browserOpen: boolean;
    browserDir: string;
    browserEntries: BrowserEntry[];
    pendingForget: boolean;
};

export function openHtswDashboard(initialPath?: string): void {
    const config = readGuiConfig();
    const importPath =
        initialPath && initialPath.length > 0
            ? stripSurroundingQuotes(initialPath)
            : config.recentImportJsonPaths[0] ?? defaultGuiConfig().recentImportJsonPaths[0];

    const runtime: DashboardRuntime = {
        gui: new Gui(),
        state: createInitialDashboardState(importPath),
        config,
        project: null,
        clickTargets: [],
        fields: [],
        focusedField: null,
        rowScroll: 0,
        browserOpen: false,
        browserDir: directoryForPath(importPath),
        browserEntries: [],
        pendingForget: false,
    };

    runtime.gui.setDoesPauseGame(false);
    runtime.gui.registerDraw((mouseX, mouseY) => drawDashboard(runtime, mouseX, mouseY));
    runtime.gui.registerClicked((mouseX, mouseY, button) => {
        if (button !== 0) return;
        handleClick(runtime, mouseX, mouseY);
    });
    runtime.gui.registerScrolled((_mouseX, _mouseY, scroll) => {
        runtime.rowScroll = Math.max(0, runtime.rowScroll + (scroll < 0 ? 1 : -1));
    });
    runtime.gui.registerKeyTyped((typed, key) => handleKey(runtime, typed, key));
    runtime.gui.open();

    loadPath(runtime, importPath);
    resolveHousing(runtime);
}

function drawDashboard(runtime: DashboardRuntime, mouseX: number, mouseY: number): void {
    runtime.clickTargets = [];
    runtime.fields = [];

    const width = Renderer.screen.getWidth();
    const height = Renderer.screen.getHeight();
    Renderer.drawRect(Colors.bg, 0, 0, width, height);

    drawTopBar(runtime, width);
    drawLeftRail(runtime, height);
    drawTable(runtime, width, height);
    drawBottomBar(runtime, width, height);
    if (runtime.browserOpen) {
        drawBrowser(runtime, width, height);
    }

    if (runtime.pendingForget) {
        drawConfirm(runtime, width, height);
    }

    void mouseX;
    void mouseY;
}

function drawTopBar(runtime: DashboardRuntime, width: number): void {
    drawPanel({ x: 8, y: 8, w: width - 16, h: 42 });
    runtime.gui.drawString("HTSW", 18, 17, Colors.accent);
    runtime.gui.drawString(
        houseLabel(runtime),
        18,
        31,
        runtime.state.housingUuid ? Colors.text : Colors.muted
    );

    const pathField = field(runtime, "importPath", "import.json", runtime.state.importPath, {
        x: 120,
        y: 12,
        w: Math.max(160, width - 520),
        h: 32,
    });
    drawTextField(runtime.gui, pathField, runtime.focusedField === "importPath");
    if (runtime.focusedField === "aliasValue") {
        const aliasField = field(runtime, "aliasValue", "house alias", runtime.state.houseAlias ?? "", {
            x: 120,
            y: 12,
            w: Math.max(160, width - 520),
            h: 32,
        });
        drawTextField(runtime.gui, aliasField, true);
    }

    button(runtime, "load", "Load", { x: width - 390, y: 14, w: 54, h: 24 });
    button(runtime, "browse", "Browse", { x: width - 330, y: 14, w: 64, h: 24 });
    toggle(runtime, "trust", "Trust", runtime.state.trustModeEnabled, {
        x: width - 258,
        y: 14,
        w: 74,
        h: 24,
    });
    button(runtime, "refresh", "Refresh", { x: width - 176, y: 14, w: 70, h: 24 });
    button(runtime, "alias", "Alias", { x: width - 98, y: 14, w: 70, h: 24 }, runtime.state.housingUuid !== null);
}

function drawLeftRail(runtime: DashboardRuntime, height: number): void {
    drawPanel({ x: 8, y: 58, w: 150, h: height - 108 });
    runtime.gui.drawString("Recent", 18, 68, Colors.muted);
    let y = 84;
    for (const path of runtime.config.recentImportJsonPaths.slice(0, 8)) {
        const rect = { x: 14, y, w: 138, h: 18 };
        Renderer.drawRect(path === runtime.state.importPath ? Colors.rowSelected : Colors.row, rect.x, rect.y, rect.w, rect.h);
        runtime.gui.drawString(trimText(path, 20), rect.x + 5, rect.y + 5, Colors.text);
        runtime.clickTargets.push({ kind: "recent", path, rect });
        y += 21;
    }

    y += 8;
    runtime.gui.drawString("Filter", 18, y, Colors.muted);
    y += 16;
    for (const filter of ["all", "current", "stale", "missing", "selected"] as DashboardFilter[]) {
        button(runtime, `filter:${filter}`, filter, { x: 14, y, w: 138, h: 18 });
        y += 21;
    }
}

function drawTable(runtime: DashboardRuntime, width: number, height: number): void {
    const x = 166;
    const y = 58;
    const w = width - 174;
    const h = height - 108;
    drawPanel({ x, y, w, h });

    runtime.gui.drawString("Sel", x + 8, y + 8, Colors.muted);
    runtime.gui.drawString("Type", x + 44, y + 8, Colors.muted);
    runtime.gui.drawString("Name", x + 118, y + 8, Colors.muted);
    runtime.gui.drawString("Knowledge", x + Math.max(260, w - 300), y + 8, Colors.muted);
    runtime.gui.drawString("Hash", x + Math.max(360, w - 190), y + 8, Colors.muted);
    runtime.gui.drawString("Writer", x + Math.max(450, w - 90), y + 8, Colors.muted);

    const rows = visibleRows(runtime.state);
    const rowHeight = 19;
    const maxRows = Math.max(1, Math.floor((h - 34) / rowHeight));
    if (runtime.rowScroll > Math.max(0, rows.length - maxRows)) {
        runtime.rowScroll = Math.max(0, rows.length - maxRows);
    }
    const shown = rows.slice(runtime.rowScroll, runtime.rowScroll + maxRows);

    let rowY = y + 28;
    for (const row of shown) {
        const rect = { x: x + 6, y: rowY, w: w - 12, h: rowHeight - 2 };
        Renderer.drawRect(row.selected ? Colors.rowSelected : Colors.row, rect.x, rect.y, rect.w, rect.h);
        runtime.gui.drawString(row.selected ? "[x]" : "[ ]", rect.x + 4, rect.y + 5, Colors.text);
        runtime.gui.drawString(row.type, rect.x + 40, rect.y + 5, Colors.text);
        runtime.gui.drawString(trimText(row.identity, 34), rect.x + 112, rect.y + 5, isImportableSupported(row.importable) ? Colors.text : Colors.muted);
        const state = isImportableSupported(row.importable) ? row.knowledgeState : "unsupported";
        runtime.gui.drawString(state, x + Math.max(260, w - 300), rect.y + 5, stateColor(state));
        runtime.gui.drawString(shortHash(row.sourceHash), x + Math.max(360, w - 190), rect.y + 5, Colors.muted);
        runtime.gui.drawString(row.writer ?? "-", x + Math.max(450, w - 90), rect.y + 5, Colors.muted);
        runtime.clickTargets.push({ kind: "row", id: row.id, rect });
        rowY += rowHeight;
    }

    if (rows.length === 0) {
        runtime.gui.drawString(emptyTableText(runtime), x + 12, y + 36, Colors.muted);
    }
}

function drawBottomBar(runtime: DashboardRuntime, width: number, height: number): void {
    drawPanel({ x: 8, y: height - 42, w: width - 16, h: 34 });
    button(runtime, "importSelected", "Import Selected", { x: 18, y: height - 34, w: 112, h: 20 }, canMutate(runtime));
    button(runtime, "importDirty", "Import Stale/Missing", { x: 136, y: height - 34, w: 132, h: 20 }, canMutate(runtime));
    button(runtime, "forget", runtime.pendingForget ? "Confirm Forget" : "Forget Selected", { x: 274, y: height - 34, w: 114, h: 20 }, runtime.state.housingUuid !== null && selectedRows(runtime).length > 0);

    const nameField = field(runtime, "exportName", "function", runtime.state.exportFunctionName, {
        x: 402,
        y: height - 38,
        w: 122,
        h: 28,
    });
    drawTextField(runtime.gui, nameField, runtime.focusedField === "exportName");
    const rootField = field(runtime, "exportRoot", "export root", runtime.state.exportRoot, {
        x: 530,
        y: height - 38,
        w: Math.max(120, width - 774),
        h: 28,
    });
    drawTextField(runtime.gui, rootField, runtime.focusedField === "exportRoot");
    button(runtime, "exportFunction", "Export Function", { x: width - 226, y: height - 34, w: 112, h: 20 }, canMutate(runtime) && runtime.state.exportFunctionName.trim().length > 0);
    button(runtime, "selectVisible", "Select Visible", { x: width - 108, y: height - 34, w: 92, h: 20 });

    runtime.gui.drawString(runtime.state.statusMessage ?? statusSummary(runtime), 18, height - 52, Colors.muted);
}

function drawBrowser(runtime: DashboardRuntime, width: number, height: number): void {
    const rect = { x: 52, y: 60, w: width - 104, h: height - 118 };
    Renderer.drawRect(0xf4111419, rect.x, rect.y, rect.w, rect.h);
    runtime.gui.drawString("Browser", rect.x + 10, rect.y + 9, Colors.accent);
    button(runtime, "browserClose", "Close", { x: rect.x + rect.w - 62, y: rect.y + 7, w: 50, h: 18 });
    button(runtime, "browserUp", "Up", { x: rect.x + rect.w - 118, y: rect.y + 7, w: 46, h: 18 });

    const pathField = field(runtime, "browserPath", "directory", runtime.browserDir, {
        x: rect.x + 10,
        y: rect.y + 30,
        w: rect.w - 20,
        h: 30,
    });
    drawTextField(runtime.gui, pathField, runtime.focusedField === "browserPath");

    let y = rect.y + 68;
    for (const entry of runtime.browserEntries.slice(0, Math.floor((rect.h - 76) / 19))) {
        const entryRect = { x: rect.x + 10, y, w: rect.w - 20, h: 17 };
        Renderer.drawRect(entry.kind === "directory" ? Colors.rowSelected : Colors.row, entryRect.x, entryRect.y, entryRect.w, entryRect.h);
        runtime.gui.drawString(`${entry.kind === "directory" ? "/" : ""}${trimText(entry.name, 70)}`, entryRect.x + 5, entryRect.y + 5, entry.kind === "file" ? Colors.muted : Colors.text);
        runtime.clickTargets.push({ kind: "browser", entry, rect: entryRect });
        y += 19;
    }
}

function drawConfirm(runtime: DashboardRuntime, width: number, height: number): void {
    const rect = { x: width / 2 - 130, y: height / 2 - 36, w: 260, h: 72 };
    Renderer.drawRect(0xf2202026, rect.x, rect.y, rect.w, rect.h);
    runtime.gui.drawString(`Forget ${selectedRows(runtime).length} selected knowledge entries?`, rect.x + 12, rect.y + 14, Colors.text);
    button(runtime, "forgetConfirm", "Forget", { x: rect.x + 52, y: rect.y + 42, w: 66, h: 20 });
    button(runtime, "forgetCancel", "Cancel", { x: rect.x + 140, y: rect.y + 42, w: 66, h: 20 });
}

function handleClick(runtime: DashboardRuntime, x: number, y: number): void {
    const target = runtime.clickTargets.find((entry) => contains(entry.rect, x, y));
    runtime.focusedField = null;
    if (!target) return;

    if (target.kind === "field") {
        runtime.focusedField = target.id;
        return;
    }
    if (target.kind === "row") {
        toggleRow(runtime, target.id);
        return;
    }
    if (target.kind === "recent") {
        loadPath(runtime, target.path);
        return;
    }
    if (target.kind === "browser") {
        if (target.entry.kind === "directory") {
            runtime.browserDir = target.entry.absolutePath;
            refreshBrowser(runtime);
        } else {
            loadPath(runtime, target.entry.absolutePath);
            runtime.browserOpen = false;
        }
        return;
    }
    if (target.kind === "button" && target.enabled) {
        handleButton(runtime, target.id);
    }
}

function handleButton(runtime: DashboardRuntime, id: string): void {
    if (id.startsWith("filter:")) {
        runtime.state.filter = id.slice("filter:".length) as DashboardFilter;
        runtime.rowScroll = 0;
        return;
    }
    if (id === "load") loadPath(runtime, runtime.state.importPath);
    if (id === "browse") {
        runtime.browserOpen = true;
        runtime.browserDir = directoryForPath(runtime.state.importPath);
        refreshBrowser(runtime);
    }
    if (id === "refresh") {
        loadPath(runtime, runtime.state.importPath);
        resolveHousing(runtime);
    }
    if (id === "trust") runtime.state.trustModeEnabled = !runtime.state.trustModeEnabled;
    if (id === "alias") focusAlias(runtime);
    if (id === "browserClose") runtime.browserOpen = false;
    if (id === "browserUp") {
        const parent = parentDirectory(runtime.browserDir);
        if (parent !== null) {
            runtime.browserDir = parent;
            refreshBrowser(runtime);
        }
    }
    if (id === "selectVisible") selectVisible(runtime);
    if (id === "importSelected") startImport(runtime, selectedRows(runtime));
    if (id === "importDirty") {
        startImport(
            runtime,
            runtime.state.rows.filter(
                (row) =>
                    row.knowledgeState !== "current" && isImportableSupported(row.importable)
            )
        );
    }
    if (id === "forget") {
        const rows = selectedRows(runtime);
        if (rows.length > 1) runtime.pendingForget = true;
        else forgetRows(runtime, rows);
    }
    if (id === "forgetConfirm") forgetRows(runtime, selectedRows(runtime));
    if (id === "forgetCancel") runtime.pendingForget = false;
    if (id === "exportFunction") startExport(runtime);
}

function handleKey(runtime: DashboardRuntime, typed: string, key: number): void {
    if (key === 1) {
        if (runtime.browserOpen) {
            runtime.browserOpen = false;
            return;
        }
        runtime.gui.close();
        return;
    }

    if (runtime.focusedField !== null) {
        editFocusedField(runtime, typed, key);
        return;
    }

    if (key === 19) {
        loadPath(runtime, runtime.state.importPath);
        resolveHousing(runtime);
    } else if (key === 30 && runtime.gui.isControlDown()) {
        selectVisible(runtime);
    }
}

function editFocusedField(runtime: DashboardRuntime, typed: string, key: number): void {
    const id = runtime.focusedField;
    if (id === null) return;
    if (key === 14) {
        setFieldValue(runtime, id, getFieldValue(runtime, id).slice(0, -1));
        return;
    }
    if (key === 28) {
        if (id === "importPath") loadPath(runtime, runtime.state.importPath);
        if (id === "browserPath") {
            runtime.browserDir = getFieldValue(runtime, id);
            refreshBrowser(runtime);
        }
        if (id === "aliasValue") commitAlias(runtime);
        runtime.focusedField = null;
        return;
    }
    if (typed && typed >= " " && typed !== "\u007f") {
        setFieldValue(runtime, id, getFieldValue(runtime, id) + typed);
    }
}

function loadPath(runtime: DashboardRuntime, rawPath: string): void {
    const path = stripSurroundingQuotes(rawPath.trim() || "import.json");
    runtime.state.importPath = path;
    runtime.state.parseStatus = { kind: "loading" };
    runtime.project = loadImportProject(path);
    runtime.state.diagnostics = runtime.project.kind === "ready"
        ? runtime.project.diagnostics
        : runtime.project.diagnostics ?? [];

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
        runtime.state.statusMessage = `Load failed: ${runtime.project.message}`;
    }
}

function resolveHousing(runtime: DashboardRuntime): void {
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

function startImport(runtime: DashboardRuntime, rows: DashboardRow[]): void {
    const housingUuid = runtime.state.housingUuid;
    if (housingUuid === null || rows.length === 0 || runtime.state.activeTask !== null) return;
    const supported = rows.filter((row) => isImportableSupported(row.importable));
    if (supported.length === 0) return;

    runtime.state.activeTask = { kind: "import", label: `Importing ${supported.length}` };
    const importables = supported.map((row) => row.importable);
    const sourcePath = runtime.state.importPath;
    const trustMode = runtime.state.trustModeEnabled;
    if (trustMode && runtime.project?.kind === "ready") {
        const trustPlan = buildKnowledgeTrustPlan(housingUuid, runtime.project.importables);
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
    TaskManager.run(async (ctx) => {
        ctx.displayMessage(
            `&a[gui] Importing ${importables.length} importable(s)${trustMode ? " with trust mode" : ""}.`
        );
        const result = await importSelectedImportables(ctx, {
            importables,
            trustMode,
            housingUuid,
            sourcePath,
        });
        ctx.displayMessage(
            `&a[gui] Import done: ${result.imported} imported, ${result.skippedTrusted} trusted skip, ${result.failed} failed.`
        );
    }).catch((error) => {
        ChatLib.chat(`&c[gui] Import failed: ${error}`);
    });
}

function startExport(runtime: DashboardRuntime): void {
    const housingUuid = runtime.state.housingUuid;
    const name = runtime.state.exportFunctionName.trim();
    if (housingUuid === null || name.length === 0 || runtime.state.activeTask !== null) return;
    const rootDir = (runtime.state.exportRoot || defaultExportRoot(housingUuid)).replace(/[\\/]+$/, "");
    const importJsonPath = `${rootDir}/import.json`;
    const filename = `${canonicalSlug(name)}.htsl`;

    runtime.state.activeTask = { kind: "export", label: `Exporting ${name}` };
    runtime.gui.close();
    TaskManager.run(async (ctx) => {
        await exportImportable(ctx, {
            type: "FUNCTION",
            name,
            importJsonPath,
            htslPath: `${rootDir}/${filename}`,
            htslReference: filename,
        });
    }).catch((error) => {
        ChatLib.chat(`&c[gui] Export failed: ${error}`);
    });
}

function forgetRows(runtime: DashboardRuntime, rows: DashboardRow[]): void {
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

function field(
    runtime: DashboardRuntime,
    id: string,
    label: string,
    value: string,
    rect: Rect
): TextField {
    const textField = { id, label, value, rect };
    runtime.fields.push(textField);
    runtime.clickTargets.push({ kind: "field", id, rect });
    return textField;
}

function button(
    runtime: DashboardRuntime,
    id: string,
    label: string,
    rect: Rect,
    enabled: boolean = true
): void {
    drawButton(runtime.gui, rect, label, enabled);
    runtime.clickTargets.push({ kind: "button", id, rect, enabled });
}

function toggle(runtime: DashboardRuntime, id: string, label: string, on: boolean, rect: Rect): void {
    drawToggle(runtime.gui, rect, label, on);
    runtime.clickTargets.push({ kind: "button", id, rect, enabled: true });
}

function refreshBrowser(runtime: DashboardRuntime): void {
    runtime.browserDir = normalizePathForDisplay(runtime.browserDir);
    runtime.browserEntries = listBrowserEntries(runtime.browserDir);
}

function toggleRow(runtime: DashboardRuntime, id: string): void {
    runtime.state.rows = runtime.state.rows.map((row) =>
        row.id === id ? { ...row, selected: !row.selected } : row
    );
}

function selectVisible(runtime: DashboardRuntime): void {
    const ids = new Set(visibleRows(runtime.state).map((row) => row.id));
    const allSelected = runtime.state.rows
        .filter((row) => ids.has(row.id))
        .every((row) => row.selected);
    runtime.state.rows = runtime.state.rows.map((row) =>
        ids.has(row.id) ? { ...row, selected: !allSelected } : row
    );
}

function selectedRows(runtime: DashboardRuntime): DashboardRow[] {
    return runtime.state.rows.filter((row) => row.selected);
}

function canMutate(runtime: DashboardRuntime): boolean {
    return runtime.state.housingUuid !== null && runtime.state.activeTask === null;
}

function statusSummary(runtime: DashboardRuntime): string {
    const selected = selectedRows(runtime).length;
    const current = runtime.state.rows.filter((row) => row.knowledgeState === "current").length;
    const stale = runtime.state.rows.filter((row) => row.knowledgeState === "stale").length;
    const missing = runtime.state.rows.filter((row) => row.knowledgeState === "missing").length;
    return `${runtime.state.rows.length} rows, ${selected} selected, ${current} current, ${stale} stale, ${missing} missing`;
}

function emptyTableText(runtime: DashboardRuntime): string {
    if (runtime.state.parseStatus.kind === "error") return runtime.state.parseStatus.message;
    if (runtime.state.parseStatus.kind === "loading") return "Loading...";
    return "No rows.";
}

function houseLabel(runtime: DashboardRuntime): string {
    if (runtime.state.housingUuid === null) return "House: unresolved";
    return `House: ${runtime.state.houseAlias ?? shortenUuid(runtime.state.housingUuid)}`;
}

function shortenUuid(uuid: string): string {
    return uuid.length <= 12 ? uuid : `${uuid.slice(0, 8)}...${uuid.slice(-4)}`;
}

function focusAlias(runtime: DashboardRuntime): void {
    if (runtime.state.housingUuid === null) return;
    runtime.focusedField = "aliasValue";
    runtime.state.statusMessage = "Type house alias and press Enter.";
}

function commitAlias(runtime: DashboardRuntime): void {
    const uuid = runtime.state.housingUuid;
    if (uuid === null) return;
    runtime.config = setHouseAlias(runtime.config, uuid, runtime.state.houseAlias ?? "");
    writeGuiConfig(runtime.config);
}

function getFieldValue(runtime: DashboardRuntime, id: string): string {
    if (id === "importPath") return runtime.state.importPath;
    if (id === "exportName") return runtime.state.exportFunctionName;
    if (id === "exportRoot") return runtime.state.exportRoot;
    if (id === "browserPath") return runtime.browserDir;
    if (id === "aliasValue") return runtime.state.houseAlias ?? "";
    return "";
}

function setFieldValue(runtime: DashboardRuntime, id: string, value: string): void {
    if (id === "importPath") runtime.state.importPath = value;
    if (id === "exportName") runtime.state.exportFunctionName = value;
    if (id === "exportRoot") runtime.state.exportRoot = value;
    if (id === "browserPath") runtime.browserDir = value;
    if (id === "aliasValue") runtime.state.houseAlias = value;
}
