import { TaskManager } from "../tasks/manager";
import { stripSurroundingQuotes } from "../utils/strings";
import { getItemFromNbt } from "../utils/nbt";

import { readGuiConfig } from "./config";
import {
    createDirectory,
    createFile,
    defaultImportJsonPath,
    deletePathRecursive,
    directoryForPath,
    joinPath,
    minecraftHtswRoot,
    openDirectoryInOSFileExplorer,
    parentDirectory,
} from "./files";
import { createInitialDashboardState, type DashboardFilter } from "./model";
import type {
    ContextMenuItem,
    DashboardRuntime,
    PromptState,
} from "./dashboardRuntime";
import {
    closeTab,
    commitAlias,
    ensureJsonTabForActiveImport,
    focusAlias,
    getFieldValue,
    modifiedOrUnknownRows,
    openHtslTab,
    openImportableTab,
    pinTab,
    refreshBrowser,
    selectedRows,
    selectVisible,
    setActiveTab,
    setFieldValue,
    setPreviewRow,
    toggleRow,
} from "./dashboardState";
import {
    forgetRows,
    loadPath,
    resolveHousing,
    startExport,
    startImport,
} from "./dashboardTasks";
import {
    buildBrowserBackgroundContextMenuItems,
    buildBrowserEntryContextMenuItems,
    drawDashboard,
    normalizeMousePoint,
} from "./dashboardView";
import { contains } from "./widgets";

const INIT_IMPORT_JSON = '{\n    "functions": []\n}\n';

export function openHtswDashboard(initialPath?: string): void {
    const config = readGuiConfig();
    const importPath =
        initialPath && initialPath.length > 0
            ? stripSurroundingQuotes(initialPath)
            : (config.recentImportJsonPaths[0] ?? defaultImportJsonPath());

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
        browserDir: minecraftHtswRoot(),
        browserEntries: [],
        pendingForget: false,
        renderErrorReported: false,
        mouseX: 0,
        mouseY: 0,
        tooltips: [],
        contextMenu: null,
        pendingPrompt: null,
        progress: null,
        overlayTrigger: null,
        lastClick: null,
    };

    runtime.gui.setDoesPauseGame(false);
    runtime.gui.registerDraw((mouseX, mouseY) => {
        try {
            drawDashboard(runtime, mouseX, mouseY);
        } catch (error) {
            if (!runtime.renderErrorReported) {
                runtime.renderErrorReported = true;
                ChatLib.chat(`&c[gui] render failed: ${error}`);
            }
        }
    });
    runtime.gui.registerClicked((mouseX, mouseY, button) => {
        if (button === 0) handleClick(runtime, mouseX, mouseY);
        else if (button === 1) handleRightClick(runtime, mouseX, mouseY);
    });
    runtime.gui.registerScrolled((_mouseX, _mouseY, scroll) => {
        runtime.rowScroll = Math.max(0, runtime.rowScroll + (scroll < 0 ? 1 : -1));
    });
    runtime.gui.registerKeyTyped((typed, key) => handleKey(runtime, typed, key));
    runtime.gui.open();

    loadPath(runtime, importPath);
    if (runtime.project?.kind === "error") {
        runtime.browserOpen = true;
        runtime.browserDir = minecraftHtswRoot();
        refreshBrowser(runtime);
    }
    resolveHousing(runtime);
}

function handleClick(runtime: DashboardRuntime, x: number, y: number): void {
    const point = normalizeMousePoint(x, y);
    const target = [...runtime.clickTargets]
        .reverse()
        .find(
            (entry) =>
                entry.kind !== "tooltipSource" &&
                contains(entry.rect, point.x, point.y)
        );

    // If a context menu is open, close it unless we're clicking one of its items.
    if (runtime.contextMenu !== null && (!target || target.kind !== "contextItem")) {
        runtime.contextMenu = null;
    }

    runtime.focusedField = null;
    if (!target) {
        runtime.lastClick = null;
        return;
    }

    // Double-click detection — used by row/tab targets to upgrade to "pinned".
    const targetKey = clickTargetKey(target);
    const now = Date.now();
    const isDouble =
        runtime.lastClick !== null &&
        runtime.lastClick.key === targetKey &&
        now - runtime.lastClick.t < 400;
    runtime.lastClick = { key: targetKey, t: now };

    if (target.kind === "field") {
        runtime.focusedField = target.id;
        return;
    }
    if (target.kind === "row") {
        toggleRow(runtime, target.id);
        openImportableTab(runtime, target.id, isDouble);
        return;
    }
    if (target.kind === "tab") {
        if (isDouble) {
            pinTab(runtime, target.tabId);
        }
        setActiveTab(runtime, target.tabId);
        return;
    }
    if (target.kind === "tabClose") {
        closeTab(runtime, target.tabId);
        return;
    }
    if (target.kind === "openHtslTab") {
        openHtslTab(runtime, target.rowId, isDouble);
        return;
    }
    if (target.kind === "recent") {
        loadPath(runtime, target.path);
        ensureJsonTabForActiveImport(runtime);
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
    if (target.kind === "browserBackground") {
        // Left click on background does nothing; right click opens directory menu.
        return;
    }
    if (target.kind === "previewCmd") {
        ChatLib.command(target.cmd.replace(/^\//, ""));
        return;
    }
    if (target.kind === "previewCopyNbt") {
        copyRowNbt(runtime, target.rowId);
        return;
    }
    if (target.kind === "previewGiveItem") {
        giveRowItem(runtime, target.rowId);
        return;
    }
    if (target.kind === "contextItem") {
        if (target.enabled) handleContextItem(runtime, target.id, target.payload);
        runtime.contextMenu = null;
        return;
    }
    if (target.kind === "button" && target.enabled) {
        handleButton(runtime, target.id);
    }
}

function handleRightClick(runtime: DashboardRuntime, x: number, y: number): void {
    const point = normalizeMousePoint(x, y);

    // Right-clicking anywhere closes an open prompt or context menu first.
    if (runtime.contextMenu !== null) {
        runtime.contextMenu = null;
        return;
    }

    // Find the topmost interactive target under the cursor.
    const target = [...runtime.clickTargets]
        .reverse()
        .find(
            (entry) =>
                entry.kind !== "tooltipSource" &&
                contains(entry.rect, point.x, point.y)
        );

    if (!target) return;

    if (target.kind === "browser") {
        runtime.contextMenu = {
            x: point.x,
            y: point.y,
            items: buildBrowserEntryContextMenuItems(target.entry),
        };
        return;
    }
    if (target.kind === "browserBackground") {
        runtime.contextMenu = {
            x: point.x,
            y: point.y,
            items: buildBrowserBackgroundContextMenuItems(runtime),
        };
        return;
    }
    if (target.kind === "row") {
        // Right-click also sets the preview without toggling selection.
        setPreviewRow(runtime, target.id);
        return;
    }
}

function handleContextItem(
    runtime: DashboardRuntime,
    id: string,
    payload: string | undefined
): void {
    switch (id) {
        case "ctx.delete":
            if (payload) {
                const result = deletePathRecursive(payload);
                if (!result.ok) {
                    runtime.state.statusMessage = `Delete failed: ${result.error}`;
                } else {
                    runtime.state.statusMessage = `Deleted ${payload}.`;
                }
                refreshBrowser(runtime);
            }
            return;
        case "ctx.openInOS":
            if (payload) {
                const result = openDirectoryInOSFileExplorer(payload);
                if (!result.ok) {
                    runtime.state.statusMessage = `Open in OS failed: ${result.error}`;
                }
            }
            return;
        case "ctx.newFile":
            openPrompt(runtime, "newFile", payload ?? runtime.browserDir);
            return;
        case "ctx.newFolder":
            openPrompt(runtime, "newFolder", payload ?? runtime.browserDir);
            return;
        case "ctx.initImport":
            if (payload) initImportJson(runtime, payload);
            return;
        case "ctx.openEntry":
            if (payload) {
                const fileEntry = runtime.browserEntries.find(
                    (entry) => entry.absolutePath === payload
                );
                if (fileEntry && fileEntry.kind === "directory") {
                    runtime.browserDir = payload;
                    refreshBrowser(runtime);
                } else {
                    loadPath(runtime, payload);
                    runtime.browserOpen = false;
                }
            }
            return;
    }
}

function handleButton(runtime: DashboardRuntime, id: string): void {
    if (id.startsWith("filter:")) {
        runtime.state.filter = id.slice("filter:".length) as DashboardFilter;
        runtime.rowScroll = 0;
        return;
    }

    switch (id) {
        case "load":
            loadPath(runtime, runtime.state.importPath);
            return;
        case "browse":
            runtime.browserOpen = true;
            runtime.browserDir =
                runtime.project?.kind === "error"
                    ? minecraftHtswRoot()
                    : directoryForPath(runtime.state.importPath);
            refreshBrowser(runtime);
            return;
        case "refresh":
            loadPath(runtime, runtime.state.importPath);
            resolveHousing(runtime);
            return;
        case "trust":
            runtime.state.trustModeEnabled = !runtime.state.trustModeEnabled;
            runtime.state.statusMessage = runtime.state.trustModeEnabled
                ? "Trust on: current Knowledge can skip live GUI reads this import run."
                : "Trust off: imports will verify through live Housing GUI reads.";
            return;
        case "alias":
            focusAlias(runtime);
            return;
        case "browserClose":
            runtime.browserOpen = false;
            return;
        case "browserUp":
            openParentBrowserDirectory(runtime);
            return;
        case "browserRefresh":
            refreshBrowser(runtime);
            return;
        case "browserOpenInOS": {
            const result = openDirectoryInOSFileExplorer(runtime.browserDir);
            if (!result.ok) {
                runtime.state.statusMessage = `Open in OS failed: ${result.error}`;
            }
            return;
        }
        case "browserNewFile":
            openPrompt(runtime, "newFile", runtime.browserDir);
            return;
        case "browserNewFolder":
            openPrompt(runtime, "newFolder", runtime.browserDir);
            return;
        case "browserInitImport":
            initImportJson(runtime, runtime.browserDir);
            return;
        case "promptOk":
            commitPrompt(runtime);
            return;
        case "promptCancel":
            runtime.pendingPrompt = null;
            runtime.focusedField = null;
            return;
        case "selectVisible":
            selectVisible(runtime);
            return;
        case "importSelected":
            startImport(runtime, selectedRows(runtime));
            return;
        case "importDirty":
            startImport(runtime, modifiedOrUnknownRows(runtime));
            return;
        case "forget":
            requestForget(runtime);
            return;
        case "forgetConfirm":
            forgetRows(runtime, selectedRows(runtime));
            return;
        case "forgetCancel":
            runtime.pendingForget = false;
            return;
        case "exportFunction":
            startExport(runtime);
            return;
        case "cancelTask":
            if (runtime.state.activeTask !== null) {
                TaskManager.cancelAll();
                runtime.state.statusMessage = "Cancellation requested.";
            }
            return;
    }
}

function openPrompt(
    runtime: DashboardRuntime,
    kind: "newFile" | "newFolder",
    parentDir: string
): void {
    runtime.pendingPrompt = {
        kind,
        title: kind === "newFile" ? "New file name:" : "New folder name:",
        value: "",
        parentDir,
    };
    runtime.focusedField = "promptValue";
}

function commitPrompt(runtime: DashboardRuntime): void {
    const prompt = runtime.pendingPrompt;
    if (prompt === null) return;
    const name = prompt.value.trim();
    if (name.length === 0) {
        runtime.pendingPrompt = null;
        runtime.focusedField = null;
        return;
    }
    const target = joinPath(prompt.parentDir, name);
    if (prompt.kind === "newFile") {
        const result = createFile(target, "");
        runtime.state.statusMessage = result.ok
            ? `Created file ${name}.`
            : `Create file failed: ${result.error}`;
    } else {
        const result = createDirectory(target);
        runtime.state.statusMessage = result.ok
            ? `Created folder ${name}.`
            : `Create folder failed: ${result.error}`;
    }
    runtime.pendingPrompt = null;
    runtime.focusedField = null;
    refreshBrowser(runtime);
}

function initImportJson(runtime: DashboardRuntime, directory: string): void {
    const target = joinPath(directory, "import.json");
    const result = createFile(target, INIT_IMPORT_JSON);
    if (!result.ok) {
        runtime.state.statusMessage = `Init import.json failed: ${result.error}`;
        return;
    }
    runtime.state.statusMessage = `Created import.json in ${directory}.`;
    refreshBrowser(runtime);
    loadPath(runtime, target);
    runtime.browserOpen = false;
}

function giveRowItem(runtime: DashboardRuntime, rowId: string): void {
    const row = runtime.state.rows.find((entry) => entry.id === rowId);
    if (row === undefined || row.importable.type !== "ITEM") {
        runtime.state.statusMessage = "Selected row is not an item.";
        return;
    }
    try {
        const C10 = Java.type("net.minecraft.network.play.client.C10PacketCreativeInventoryAction");
        const C09 = Java.type("net.minecraft.network.play.client.C09PacketHeldItemChange");
        const item = getItemFromNbt(row.importable.nbt);
        Client.sendPacket(new C10(36, item.getItemStack()));
        const player = Player.getPlayer();
        if (player.field_71071_by.field_70461_c !== 0) {
            Client.sendPacket(new C09(0));
            player.field_71071_by.field_70461_c = 0;
        }
        runtime.state.statusMessage = `Gave item ${row.importable.name} (slot 0).`;
    } catch (error) {
        runtime.state.statusMessage = `Give item failed: ${error}`;
    }
}

function copyRowNbt(runtime: DashboardRuntime, rowId: string): void {
    const row = runtime.state.rows.find((entry) => entry.id === rowId);
    if (row === undefined || row.importable.type !== "ITEM") {
        runtime.state.statusMessage = "No item selected for copy.";
        return;
    }
    try {
        const StringSelection = Java.type("java.awt.datatransfer.StringSelection");
        const Toolkit = Java.type("java.awt.Toolkit");
        const text = JSON.stringify(row.importable.nbt);
        const selection = new StringSelection(text);
        Toolkit.getDefaultToolkit().getSystemClipboard().setContents(selection, null);
        runtime.state.statusMessage = "Copied item NBT (JSON) to clipboard.";
    } catch (error) {
        runtime.state.statusMessage = `Copy failed: ${error}`;
    }
}

function openParentBrowserDirectory(runtime: DashboardRuntime): void {
    const parent = parentDirectory(runtime.browserDir);
    if (parent === null) return;
    runtime.browserDir = parent;
    refreshBrowser(runtime);
}

function requestForget(runtime: DashboardRuntime): void {
    const rows = selectedRows(runtime);
    if (rows.length > 1) runtime.pendingForget = true;
    else forgetRows(runtime, rows);
}

function handleKey(runtime: DashboardRuntime, typed: string, key: number): void {
    if (key === 1) {
        if (runtime.contextMenu !== null) {
            runtime.contextMenu = null;
            return;
        }
        if (runtime.pendingPrompt !== null) {
            runtime.pendingPrompt = null;
            runtime.focusedField = null;
            return;
        }
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
    if (key === 47 && runtime.gui.isControlDown()) {
        const pasted = readClipboardText();
        if (pasted.length > 0) {
            setFieldValue(runtime, id, getFieldValue(runtime, id) + pasted);
        }
        return;
    }
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
        if (id === "promptValue") {
            commitPrompt(runtime);
            return;
        }
        runtime.focusedField = null;
        return;
    }
    const character = typedCharacter(typed);
    if (character !== null) {
        setFieldValue(runtime, id, getFieldValue(runtime, id) + character);
    }
}

function typedCharacter(typed: unknown): string | null {
    if (typed === null || typed === undefined) return null;
    const value = String(typed);
    if (value.length === 0) return null;
    const character = value[0];
    if (character < " " || character === "") return null;
    return character;
}

function clickTargetKey(target: { kind: string; [key: string]: any }): string {
    switch (target.kind) {
        case "row":
            return `row:${target.id}`;
        case "tab":
            return `tab:${target.tabId}`;
        case "tabClose":
            return `tabClose:${target.tabId}`;
        case "openHtslTab":
            return `openHtslTab:${target.rowId}`;
        case "button":
            return `button:${target.id}`;
        case "browser":
            return `browser:${target.entry?.absolutePath ?? ""}`;
        case "recent":
            return `recent:${target.path}`;
        case "contextItem":
            return `ctx:${target.id}:${target.payload ?? ""}`;
        case "field":
            return `field:${target.id}`;
        default:
            return target.kind;
    }
}

function readClipboardText(): string {
    try {
        const Toolkit = Java.type("java.awt.Toolkit");
        const DataFlavor = Java.type("java.awt.datatransfer.DataFlavor");
        const clipboard = Toolkit.getDefaultToolkit().getSystemClipboard();
        const value = clipboard.getData(DataFlavor.stringFlavor);
        return String(value ?? "").replace(/[\r\n]+/g, "");
    } catch (error) {
        ChatLib.chat(`&c[gui] paste failed: ${error}`);
        return "";
    }
}
