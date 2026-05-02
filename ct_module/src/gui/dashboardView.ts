import * as htsw from "htsw";
import type { Importable } from "htsw/types";

import { Colors, stateColor } from "./colors";
import { displayPathFromHtswHome } from "./files";
import {
    diagnosticSummary,
    isBlockingDiagnostic,
    isImportableSupported,
    visibleRows,
    type DashboardFilter,
    type DashboardRow,
} from "./model";
import type { DashboardRuntime, ContextMenuItem, PromptState } from "./dashboardRuntime";
import { canMutate, selectedRows } from "./dashboardState";
import {
    contains,
    drawButton,
    drawPanel,
    drawTextField,
    drawToggle,
    flushTooltips,
    Glyphs,
    Heights,
    layoutRow,
    trimText,
    type LayoutChild,
    type Rect,
    type TextField,
} from "./widgets";

const FILTERS: readonly DashboardFilter[] = ["all", "current", "modified", "unknown"];

const HEADER_BAR_H = 42;
const BOTTOM_BAR_H = 30;
const TABLE_FOOTER_H = 36;
const RAIL_W = 112;
const STATUS_LINE_H = 12;

const FILTER_GLYPH: { [K in DashboardFilter]: string } = {
    all: "●",
    current: "✓",
    modified: "◐",
    unknown: "○",
};

const FILTER_TIP: { [K in DashboardFilter]: string } = {
    all: "Show every importable",
    current: "Show only rows whose cached knowledge matches source",
    modified: "Show rows whose source changed since cache",
    unknown: "Show rows with no cached knowledge",
};

export function drawDashboard(
    runtime: DashboardRuntime,
    mouseX: number,
    mouseY: number
): void {
    runtime.clickTargets = [];
    runtime.fields = [];
    runtime.tooltips = [];

    const width = Renderer.screen.getWidth();
    const height = Renderer.screen.getHeight();
    const mouse = normalizeMousePoint(mouseX, mouseY);
    runtime.mouseX = mouse.x;
    runtime.mouseY = mouse.y;
    Renderer.drawRect(Colors.bg, 0, 0, width, height);

    drawTopBar(runtime, width);
    drawLeftRail(runtime, height);
    const content = contentArea(width, height);
    const split = tablePreviewSplit(content);
    drawTable(runtime, content.x, content.y, split.tableW, content.h);
    if (split.previewW > 0) {
        drawPreview(runtime, split.previewX, content.y, split.previewW, content.h);
    }
    drawBottomBar(runtime, width, height);
    if (runtime.browserOpen) {
        drawBrowser(runtime, width, height);
    }
    if (runtime.pendingPrompt) {
        drawPrompt(runtime, runtime.pendingPrompt, width, height);
    }
    if (runtime.pendingForget) {
        drawConfirm(runtime, width, height);
    }
    if (runtime.contextMenu) {
        drawContextMenu(runtime);
    }
    drainTooltipSources(runtime);
    flushTooltips(runtime);
}

export function normalizeMousePoint(x: number, y: number): { x: number; y: number } {
    const width = Renderer.screen.getWidth();
    const height = Renderer.screen.getHeight();
    if (x <= width && y <= height) {
        return { x, y };
    }

    const scale = Renderer.screen.getScale();
    if (scale > 1) {
        return { x: x / scale, y: y / scale };
    }
    return { x, y };
}

function drawTopBar(runtime: DashboardRuntime, width: number): void {
    drawPanel({ x: 8, y: 8, w: width - 16, h: HEADER_BAR_H });
    runtime.gui.drawString("HTSW", 18, 14, Colors.accent);
    runtime.gui.drawString(
        houseLabel(runtime),
        18,
        28,
        runtime.state.housingUuid ? Colors.text : Colors.muted
    );

    const headerEndX = 18 + 138;
    const controlsStartX = headerEndX + 12;
    const controlsEndX = width - 12;

    // import path / alias is flex; everything else fixed.
    const children: LayoutChild[] = [
        { kind: "flex", minW: 180 },
        { kind: "fixed", w: 50 }, // Load
        { kind: "fixed", w: 60 }, // Browse
        { kind: "fixed", w: 70 }, // Trust toggle
        { kind: "fixed", w: 26 }, // Refresh icon
        { kind: "fixed", w: 60 }, // Alias
    ];
    const buttonY = 8 + Math.floor((HEADER_BAR_H - Heights.actionButton) / 2);
    const fieldY = 8 + Math.floor((HEADER_BAR_H - Heights.field) / 2);
    const rects = layoutRow(
        controlsStartX,
        controlsEndX,
        buttonY,
        Heights.actionButton,
        6,
        children
    );

    const fieldRect = { x: rects[0].x, y: fieldY, w: rects[0].w, h: Heights.field };
    if (runtime.focusedField === "aliasValue") {
        const aliasField = field(
            runtime,
            "aliasValue",
            "house alias",
            runtime.state.houseAlias ?? "",
            fieldRect
        );
        drawTextField(runtime.gui, aliasField, true, true);
    } else {
        const pathField = field(
            runtime,
            "importPath",
            "import.json",
            runtime.state.importPath,
            fieldRect,
            displayPathFromHtswHome(runtime.state.importPath)
        );
        drawTextField(
            runtime.gui,
            pathField,
            runtime.focusedField === "importPath",
            isHovered(runtime, pathField.rect)
        );
    }

    button(runtime, "load", "Load", rects[1]);
    pushTooltip(runtime, rects[1], "Reload the import.json from disk.");
    button(runtime, "browse", "Browse", rects[2]);
    pushTooltip(runtime, rects[2], "Open file browser.");
    toggle(runtime, "trust", "Trust", runtime.state.trustModeEnabled, rects[3]);
    pushTooltip(
        runtime,
        rects[3],
        "Trust: skip live GUI reads when cached Knowledge hash matches source. Faster, but trusts cache."
    );
    button(runtime, "refresh", Glyphs.refresh, rects[4]);
    pushTooltip(runtime, rects[4], "Refresh import + re-resolve housing.");
    button(
        runtime,
        "alias",
        "Alias",
        rects[5],
        runtime.state.housingUuid !== null
    );
    pushTooltip(runtime, rects[5], "Save a friendly name for this house.");
}

function drawLeftRail(runtime: DashboardRuntime, height: number): void {
    const railTop = 8 + HEADER_BAR_H + 8;
    drawPanel({
        x: 8,
        y: railTop,
        w: RAIL_W,
        h: height - bottomChromeHeight() - HEADER_BAR_H - 16,
    });
    const innerX = 14;
    let y = railTop + 6;

    // Search input at the very top of the rail.
    const searchRect = { x: innerX, y, w: RAIL_W - 12, h: Heights.field };
    const searchField = field(
        runtime,
        "searchQuery",
        "search",
        runtime.state.searchQuery,
        searchRect
    );
    drawTextField(
        runtime.gui,
        searchField,
        runtime.focusedField === "searchQuery",
        isHovered(runtime, searchField.rect)
    );
    y += Heights.field + 6;

    // Filters (no header label — the glyphs are self-explanatory).
    for (let i = 0; i < FILTERS.length; i++) {
        const filter = FILTERS[i];
        const rect = { x: innerX, y, w: RAIL_W - 12, h: Heights.compactButton };
        const active = runtime.state.filter === filter;
        Renderer.drawRect(
            active
                ? Colors.rowSelected
                : isHovered(runtime, rect)
                  ? Colors.hover
                  : Colors.panelSoft,
            rect.x,
            rect.y,
            rect.w,
            rect.h
        );
        const knowledgeColor =
            filter === "all"
                ? Colors.muted
                : filter === "current"
                  ? Colors.green
                  : filter === "modified"
                    ? Colors.yellow
                    : Colors.red;
        runtime.gui.drawString(FILTER_GLYPH[filter], rect.x + 6, rect.y + 6, knowledgeColor);
        runtime.gui.drawString(
            filter,
            rect.x + 18,
            rect.y + 6,
            active ? Colors.accent : Colors.text
        );
        runtime.clickTargets.push({
            kind: "button",
            id: `filter:${filter}`,
            rect,
            enabled: true,
        });
        pushTooltip(runtime, rect, FILTER_TIP[filter]);
        y += Heights.compactButton + 3;
    }

    // Spacer separating filters from the recent/active import.json list.
    y += 4;
    Renderer.drawRect(0x40596270, innerX, y, RAIL_W - 12, 1);
    y += 4;

    // Recent import.json paths — current path first, then the rest. No
    // "Recent" label per design ask; just an immediately useful list of paths.
    const seen = new Set<string>();
    const orderedPaths: string[] = [];
    if (runtime.state.importPath && runtime.state.importPath.length > 0) {
        orderedPaths.push(runtime.state.importPath);
        seen.add(runtime.state.importPath);
    }
    for (let i = 0; i < runtime.config.recentImportJsonPaths.length; i++) {
        const path = runtime.config.recentImportJsonPaths[i];
        if (!seen.has(path)) {
            orderedPaths.push(path);
            seen.add(path);
        }
    }
    const limit = Math.max(0, Math.floor((height - bottomChromeHeight() - y - 8) / (Heights.compactButton + 3)));
    const showPaths = orderedPaths.slice(0, Math.min(8, limit));
    for (let i = 0; i < showPaths.length; i++) {
        const path = showPaths[i];
        const rect = { x: innerX, y, w: RAIL_W - 12, h: Heights.compactButton };
        Renderer.drawRect(
            isHovered(runtime, rect)
                ? Colors.hover
                : path === runtime.state.importPath
                  ? Colors.rowSelected
                  : Colors.row,
            rect.x,
            rect.y,
            rect.w,
            rect.h
        );
        const display = displayPathFromHtswHome(path);
        runtime.gui.drawString(
            trimText(display, Math.max(8, Math.floor((rect.w - 8) / 6))),
            rect.x + 5,
            rect.y + 6,
            Colors.text
        );
        runtime.clickTargets.push({ kind: "recent", path, rect });
        pushTooltip(runtime, rect, display);
        y += Heights.compactButton + 3;
    }
}

function contentArea(
    width: number,
    height: number
): { x: number; y: number; w: number; h: number } {
    const x = 8 + RAIL_W + 8;
    const y = 8 + HEADER_BAR_H + 8;
    const w = width - x - 8;
    const h = height - y - bottomChromeHeight();
    return { x, y, w, h };
}

function tablePreviewSplit(content: { x: number; w: number }): {
    tableW: number;
    previewX: number;
    previewW: number;
} {
    if (content.w < 540) {
        return { tableW: content.w, previewX: 0, previewW: 0 };
    }
    const previewW = Math.max(220, Math.floor((content.w - 8) * 0.5));
    const tableW = content.w - 8 - previewW;
    return { tableW, previewX: content.x + tableW + 8, previewW };
}

function drawTable(
    runtime: DashboardRuntime,
    x: number,
    y: number,
    w: number,
    h: number
): void {
    drawPanel({ x, y, w, h });

    const cols = tableColumns(w);
    runtime.gui.drawString("Sel", x + 8, y + 8, Colors.muted);
    runtime.gui.drawString("Type", x + 44, y + 8, Colors.muted);
    runtime.gui.drawString("Name", x + 118, y + 8, Colors.muted);
    if (cols.knowX !== null) {
        runtime.gui.drawString(
            cols.knowCompact ? "K" : "Knowledge",
            x + cols.knowX,
            y + 8,
            Colors.muted
        );
    }

    const tableInnerH = h - TABLE_FOOTER_H;
    const rows = visibleRows(runtime.state);
    const rowHeight = 19;
    const maxRows = Math.max(1, Math.floor((tableInnerH - 34) / rowHeight));
    if (runtime.rowScroll > Math.max(0, rows.length - maxRows)) {
        runtime.rowScroll = Math.max(0, rows.length - maxRows);
    }
    const shown = rows.slice(runtime.rowScroll, runtime.rowScroll + maxRows);

    let rowY = y + 28;
    for (let i = 0; i < shown.length; i++) {
        const row = shown[i];
        const rect = { x: x + 6, y: rowY, w: w - 12, h: rowHeight - 2 };
        const isPreview = runtime.state.previewRowId === row.id;
        Renderer.drawRect(
            isHovered(runtime, rect)
                ? Colors.hover
                : isPreview
                  ? 0xe0405880
                  : row.selected
                    ? Colors.rowSelected
                    : Colors.row,
            rect.x,
            rect.y,
            rect.w,
            rect.h
        );
        runtime.gui.drawString(
            row.selected ? "[x]" : "[ ]",
            rect.x + 4,
            rect.y + 5,
            Colors.text
        );
        runtime.gui.drawString(row.type, rect.x + 40, rect.y + 5, Colors.text);
        const nameMax = Math.max(8, Math.floor(cols.nameMaxPx / 6));
        runtime.gui.drawString(
            trimText(row.identity, nameMax),
            rect.x + 112,
            rect.y + 5,
            isImportableSupported(row.importable) ? Colors.text : Colors.muted
        );
        const state = isImportableSupported(row.importable)
            ? row.knowledgeState
            : "unsupported";
        if (cols.knowX !== null) {
            const text = cols.knowCompact ? knowledgeGlyph(state) : state;
            runtime.gui.drawString(text, x + cols.knowX, rect.y + 5, stateColor(state));
        }
        runtime.clickTargets.push({ kind: "row", id: row.id, rect });
        rowY += rowHeight;
    }

    if (rows.length === 0) {
        drawEmptyTable(runtime, x + 12, y + 36, w - 24);
    }

    drawTableFooter(runtime, x, y + h - TABLE_FOOTER_H, w);
}

function tableColumns(w: number): {
    nameMaxPx: number;
    knowX: number | null;
    knowCompact: boolean;
} {
    if (w >= 380) {
        return {
            nameMaxPx: Math.max(120, w - 230),
            knowX: w - 110,
            knowCompact: false,
        };
    }
    if (w >= 260) {
        return {
            nameMaxPx: Math.max(80, w - 150),
            knowX: w - 40,
            knowCompact: true,
        };
    }
    return {
        nameMaxPx: Math.max(40, w - 120),
        knowX: w - 24,
        knowCompact: true,
    };
}

function knowledgeGlyph(
    state: "current" | "modified" | "unknown" | "unsupported"
): string {
    if (state === "current") return Glyphs.dotFilled;
    if (state === "modified") return Glyphs.dotHalf;
    if (state === "unknown") return Glyphs.dotEmpty;
    return "·";
}

function drawTableFooter(
    runtime: DashboardRuntime,
    x: number,
    y: number,
    w: number
): void {
    const stripe = { x: x + 4, y, w: w - 8, h: TABLE_FOOTER_H - 4 };
    Renderer.drawRect(0xc0181b22, stripe.x, stripe.y, stripe.w, stripe.h);
    Renderer.drawRect(0x40596270, stripe.x, stripe.y, stripe.w, 1);
    runtime.gui.drawString(`${Glyphs.export} Export`, stripe.x + 6, stripe.y + 5, Colors.accent);

    const mutatingEnabled = canMutate(runtime);
    const startX = stripe.x + 60;
    const endX = stripe.x + stripe.w - 6;
    const rowY = stripe.y + Math.floor((stripe.h - Heights.actionButton) / 2);
    const fieldY = stripe.y + Math.floor((stripe.h - Heights.field) / 2);

    const children: LayoutChild[] = [
        { kind: "fixed", w: 80 }, // type chip "function ▾"
        { kind: "flex", minW: 100 }, // name field
        { kind: "fixed", w: 24 }, // "into"
        { kind: "flex", minW: 130 }, // export root field
        { kind: "fixed", w: 86 }, // Export button
    ];
    const rects = layoutRow(startX, endX, rowY, Heights.actionButton, 6, children);

    // Type chip — non-interactive for now, hints at future switcher.
    const chipRect = rects[0];
    Renderer.drawRect(Colors.panelSoft, chipRect.x, chipRect.y, chipRect.w, chipRect.h);
    Renderer.drawRect(Colors.borderRect, chipRect.x, chipRect.y, chipRect.w, 1);
    runtime.gui.drawString(
        `function ${Glyphs.dropdown}`,
        chipRect.x + 6,
        chipRect.y + 6,
        Colors.muted
    );
    pushTooltip(runtime, chipRect, "Only function exports are wired up today. More types coming.");

    const nameField = field(
        runtime,
        "exportName",
        "function name",
        runtime.state.exportFunctionName,
        { x: rects[1].x, y: fieldY, w: rects[1].w, h: Heights.field }
    );
    drawTextField(
        runtime.gui,
        nameField,
        runtime.focusedField === "exportName",
        isHovered(runtime, nameField.rect)
    );

    runtime.gui.drawString("into", rects[2].x + 2, rects[2].y + 6, Colors.muted);

    const rootField = field(
        runtime,
        "exportRoot",
        "export root",
        runtime.state.exportRoot,
        { x: rects[3].x, y: fieldY, w: rects[3].w, h: Heights.field }
    );
    drawTextField(
        runtime.gui,
        rootField,
        runtime.focusedField === "exportRoot",
        isHovered(runtime, rootField.rect)
    );

    button(
        runtime,
        "exportFunction",
        `${Glyphs.export} Export`,
        rects[4],
        mutatingEnabled && runtime.state.exportFunctionName.trim().length > 0
    );
    pushTooltip(
        runtime,
        rects[4],
        "Write the live housing's function to <export root>/<name>.htsl and update its import.json."
    );
}

function bottomChromeHeight(): number {
    return BOTTOM_BAR_H + STATUS_LINE_H + 12;
}

const PREVIEW_HEADER_H = 30;
const PREVIEW_TABS_H = 22;

function drawPreview(
    runtime: DashboardRuntime,
    x: number,
    y: number,
    w: number,
    h: number
): void {
    drawPanel({ x, y, w, h });

    // Top header bar with action buttons (Start Import / Diff Import / Forget / Cancel).
    drawPreviewHeader(runtime, x, y, w);

    // Tab strip directly below the header.
    drawPreviewTabsStrip(runtime, x, y + PREVIEW_HEADER_H, w);

    const bodyTop = y + PREVIEW_HEADER_H + PREVIEW_TABS_H + 4;
    const bodyBottom = y + h - 6;
    const bodyX = x + 10;
    const bodyW = w - 20;
    const bodyH = bodyBottom - bodyTop;

    const activeTab =
        runtime.state.tabs.find((tab) => tab.id === runtime.state.activeTabId) ?? null;

    if (activeTab === null) {
        runtime.gui.drawString(
            "Click a row to preview it. The tab will appear here.",
            bodyX,
            bodyTop + 6,
            Colors.muted
        );
        return;
    }

    if (activeTab.kind === "json") {
        drawJsonTab(runtime, activeTab.payload, bodyX, bodyTop, bodyW, bodyH);
    } else if (activeTab.kind === "importable") {
        drawImportableTab(runtime, activeTab.payload, bodyX, bodyTop, bodyW, bodyH);
    } else if (activeTab.kind === "htsl") {
        drawHtslTab(runtime, activeTab.payload, bodyX, bodyTop, bodyW, bodyH);
    }
}

function drawPreviewHeader(
    runtime: DashboardRuntime,
    x: number,
    y: number,
    w: number
): void {
    const headerRect = { x: x + 4, y: y + 4, w: w - 8, h: PREVIEW_HEADER_H - 8 };
    Renderer.drawRect(0xc0181b22, headerRect.x, headerRect.y, headerRect.w, headerRect.h);
    Renderer.drawRect(Colors.accent, headerRect.x, headerRect.y, headerRect.w, 1);

    const mutating = canMutate(runtime);
    const selected = selectedRows(runtime);
    const buttonY = headerRect.y + Math.floor((headerRect.h - Heights.actionButton) / 2);
    const startX = headerRect.x + 6;
    const endX = headerRect.x + headerRect.w - 6;

    const children: LayoutChild[] = [
        { kind: "fixed", w: 110 }, // Start Import
        { kind: "fixed", w: 96 }, // Diff Import
        { kind: "fixed", w: 96 }, // Forget
        { kind: "flex", minW: 4 },
        { kind: "fixed", w: 70 }, // Cancel (only meaningful while a task runs; always visible for affordance)
    ];
    const rects = layoutRow(startX, endX, buttonY, Heights.actionButton, 6, children);

    button(
        runtime,
        "importSelected",
        `${Glyphs.add} Start`,
        rects[0],
        mutating
    );
    pushTooltip(
        runtime,
        rects[0],
        `Import the ${selected.length} checked row(s).`
    );

    button(
        runtime,
        "importDirty",
        `${Glyphs.refresh} Diff`,
        rects[1],
        mutating
    );
    pushTooltip(
        runtime,
        rects[1],
        "Import every modified or unknown row."
    );

    button(
        runtime,
        "forget",
        `${Glyphs.remove} Forget`,
        rects[2],
        runtime.state.housingUuid !== null && selected.length > 0
    );
    pushTooltip(runtime, rects[2], "Delete cached knowledge for selected rows.");

    button(
        runtime,
        "cancelTask",
        `${Glyphs.remove} Cancel`,
        rects[4],
        runtime.state.activeTask !== null
    );
    pushTooltip(
        runtime,
        rects[4],
        runtime.state.activeTask
            ? `Cancel: ${runtime.state.activeTask.label}`
            : "No task is running."
    );
}

function drawPreviewTabsStrip(
    runtime: DashboardRuntime,
    x: number,
    y: number,
    w: number
): void {
    const stripRect = { x: x + 4, y, w: w - 8, h: PREVIEW_TABS_H - 4 };
    Renderer.drawRect(0xc0181b22, stripRect.x, stripRect.y, stripRect.w, stripRect.h);
    Renderer.drawRect(0x40596270, stripRect.x, stripRect.y, stripRect.w, 1);

    const tabs = runtime.state.tabs;
    const activeId = runtime.state.activeTabId;
    let cx = stripRect.x + 4;
    const maxX = stripRect.x + stripRect.w - 4;

    for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        const labelText = tab.title;
        // Italic affordance for unpinned tabs: prepend an em-space and use a
        // dimmer color. Vanilla MC font has no italic glyphs.
        const labelDisplay = tab.pinned ? labelText : labelText;
        const labelLen = labelDisplay.length * 6;
        const closeW = 10;
        const tabW = Math.min(160, 8 + labelLen + 6 + closeW + 6);
        if (cx + tabW > maxX) {
            // Out of room — render an overflow indicator and stop.
            runtime.gui.drawString("...", cx, stripRect.y + 5, Colors.muted);
            break;
        }
        const isActive = tab.id === activeId;
        const tabRect = {
            x: cx,
            y: stripRect.y + 2,
            w: tabW,
            h: stripRect.h - 4,
        };
        Renderer.drawRect(
            isActive ? Colors.rowSelected : Colors.panelSoft,
            tabRect.x,
            tabRect.y,
            tabRect.w,
            tabRect.h
        );
        if (isActive) {
            Renderer.drawRect(Colors.accent, tabRect.x, tabRect.y, tabRect.w, 1);
        }
        const textColor = tab.pinned
            ? isActive
                ? Colors.text
                : Colors.text
            : isActive
              ? Colors.accent
              : Colors.muted;
        const truncated = trimText(
            labelDisplay,
            Math.max(4, Math.floor((tabW - closeW - 16) / 6))
        );
        runtime.gui.drawString(truncated, tabRect.x + 6, tabRect.y + 5, textColor);

        // Render an "x" close button.
        const closeRect = {
            x: tabRect.x + tabRect.w - closeW - 4,
            y: tabRect.y + 4,
            w: closeW,
            h: tabRect.h - 8,
        };
        runtime.gui.drawString("x", closeRect.x + 2, closeRect.y, Colors.muted);
        // Push close target FIRST so it has higher precedence than tab click.
        runtime.clickTargets.push({
            kind: "tabClose",
            tabId: tab.id,
            rect: closeRect,
        });
        runtime.clickTargets.push({ kind: "tab", tabId: tab.id, rect: tabRect });

        const tip =
            (tab.pinned ? "" : "(preview) ") +
            tab.title +
            " — double-click to pin";
        pushTooltip(runtime, tabRect, tip);
        cx += tabW + 3;
    }
}

function drawJsonTab(
    runtime: DashboardRuntime,
    path: string,
    x: number,
    y: number,
    w: number,
    h: number
): void {
    runtime.gui.drawString(
        `${Glyphs.init} ${trimText(displayPathFromHtswHome(path), Math.max(8, Math.floor((w - 8) / 6) - 4))}`,
        x,
        y + 2,
        Colors.accent
    );

    const lineH = 10;
    const charsPerLine = Math.max(8, Math.floor((w - 24) / 6));
    let lines: string[] = [];
    try {
        const raw = String(FileLib.read(path) ?? "");
        if (raw.length === 0) {
            lines = ["(empty file)"];
        } else {
            const rawLines = raw.split(/\r?\n/);
            for (let i = 0; i < rawLines.length; i++) {
                const r = rawLines[i];
                if (r.length <= charsPerLine) {
                    lines.push(r);
                } else {
                    let cursor = 0;
                    while (cursor < r.length) {
                        lines.push(r.slice(cursor, cursor + charsPerLine));
                        cursor += charsPerLine;
                    }
                }
            }
        }
    } catch (error) {
        lines = [`(read failed: ${String(error)})`];
    }

    const startY = y + 18;
    const maxLines = Math.max(2, Math.floor((h - 22) / lineH));
    const shown = lines.slice(0, maxLines);
    for (let i = 0; i < shown.length; i++) {
        const lineNo = String(i + 1);
        const padded =
            lineNo.length >= 4 ? lineNo : "    ".slice(lineNo.length) + lineNo;
        runtime.gui.drawString(padded, x, startY + i * lineH, Colors.muted);
        runtime.gui.drawString(shown[i], x + 26, startY + i * lineH, Colors.text);
    }
    if (lines.length > maxLines) {
        runtime.gui.drawString(
            `... ${lines.length - maxLines} more line(s)`,
            x,
            startY + (maxLines - 1) * lineH,
            Colors.muted
        );
    }
}

function drawImportableTab(
    runtime: DashboardRuntime,
    rowId: string,
    x: number,
    y: number,
    w: number,
    h: number
): void {
    const row = runtime.state.rows.find((entry) => entry.id === rowId);
    if (row === undefined) {
        runtime.gui.drawString(
            "(row no longer in current import.json)",
            x,
            y + 6,
            Colors.muted
        );
        return;
    }

    runtime.gui.drawString(
        `${row.type} · ${trimText(row.identity, Math.max(8, Math.floor(w / 6) - 12))}`,
        x,
        y + 2,
        Colors.accent
    );

    // Type-specific action buttons (Edit / TP / Give / View .htsl / etc.).
    const typeButtonsY = y + 16;
    drawPreviewActions(runtime, row, x, typeButtonsY, w);

    // Visual item draw for ITEM importables (if CT supports it on this stack).
    let bodyTop = typeButtonsY + Heights.actionButton + 6;
    if (row.importable.type === "ITEM") {
        try {
            const itemMod = Java.type("net.minecraft.item.ItemStack");
            void itemMod; // ensure module resolves
            const item = (Java.type("net.minecraft.nbt.NBTTagCompound"), null);
            void item;
            // Fall through to text preview; visual item draw requires more
            // plumbing than ChatTriggers exposes on every version, so we keep
            // the textual NBT view as the canonical preview for now.
        } catch (_) {
            // ignore
        }
    }

    drawPreviewBody(runtime, row.importable, x, bodyTop, w, y + h - bodyTop);
}

function drawHtslTab(
    runtime: DashboardRuntime,
    rowId: string,
    x: number,
    y: number,
    w: number,
    h: number
): void {
    const row = runtime.state.rows.find((entry) => entry.id === rowId);
    if (row === undefined) {
        runtime.gui.drawString(
            "(row no longer in current import.json)",
            x,
            y + 6,
            Colors.muted
        );
        return;
    }
    if (
        row.importable.type !== "FUNCTION" &&
        row.importable.type !== "EVENT" &&
        row.importable.type !== "REGION" &&
        row.importable.type !== "ITEM" &&
        row.importable.type !== "NPC"
    ) {
        runtime.gui.drawString(
            `(no .htsl source for ${row.importable.type})`,
            x,
            y + 6,
            Colors.muted
        );
        return;
    }

    runtime.gui.drawString(
        `${Glyphs.file} ${trimText(row.identity, Math.max(8, Math.floor(w / 6) - 8))}.htsl`,
        x,
        y + 2,
        Colors.accent
    );

    let actions: any[] = [];
    if (row.importable.type === "FUNCTION" || row.importable.type === "EVENT") {
        actions = row.importable.actions;
    } else if (row.importable.type === "REGION") {
        const f = row.importable.onEnterActions ?? [];
        const x2 = row.importable.onExitActions ?? [];
        actions = [...f, ...x2];
    } else if (row.importable.type === "ITEM") {
        actions = [
            ...(row.importable.leftClickActions ?? []),
            ...(row.importable.rightClickActions ?? []),
        ];
    } else if (row.importable.type === "NPC") {
        actions = [
            ...(row.importable.leftClickActions ?? []),
            ...(row.importable.rightClickActions ?? []),
        ];
    }

    const lineH = 10;
    const charsPerLine = Math.max(8, Math.floor((w - 24) / 6));
    let lines: string[] = [];
    try {
        const source = htsw.htsl.printActions(actions);
        const rawLines = source.split(/\r?\n/);
        for (let i = 0; i < rawLines.length; i++) {
            const r = rawLines[i];
            if (r.length <= charsPerLine) {
                lines.push(r);
            } else {
                let cursor = 0;
                while (cursor < r.length) {
                    lines.push(r.slice(cursor, cursor + charsPerLine));
                    cursor += charsPerLine;
                }
            }
        }
        if (lines.length === 0) lines.push("(no actions)");
    } catch (error) {
        lines = [`(htsl preview failed: ${String(error)})`];
    }

    const startY = y + 18;
    const maxLines = Math.max(2, Math.floor((h - 22) / lineH));
    const shown = lines.slice(0, maxLines);
    for (let i = 0; i < shown.length; i++) {
        const lineNo = String(i + 1);
        const padded =
            lineNo.length >= 4 ? lineNo : "    ".slice(lineNo.length) + lineNo;
        runtime.gui.drawString(padded, x, startY + i * lineH, Colors.muted);
        runtime.gui.drawString(shown[i], x + 26, startY + i * lineH, Colors.text);
    }
    if (lines.length > maxLines) {
        runtime.gui.drawString(
            `... ${lines.length - maxLines} more line(s)`,
            x,
            startY + (maxLines - 1) * lineH,
            Colors.muted
        );
    }
}

function findPreviewRow(runtime: DashboardRuntime): DashboardRow | null {
    const id = runtime.state.previewRowId;
    if (id === null) return null;
    for (let i = 0; i < runtime.state.rows.length; i++) {
        if (runtime.state.rows[i].id === id) return runtime.state.rows[i];
    }
    return null;
}

function drawPreviewBody(
    runtime: DashboardRuntime,
    importable: Importable,
    x: number,
    y: number,
    w: number,
    h: number
): void {
    const charsPerLine = Math.max(8, Math.floor(w / 6));
    const lineH = 10;
    const maxLines = Math.max(2, Math.floor(h / lineH));
    const lines = previewLines(importable, charsPerLine);
    const shown = lines.slice(0, maxLines);
    for (let i = 0; i < shown.length; i++) {
        const line = shown[i];
        runtime.gui.drawString(line.text, x, y + i * lineH, line.color);
    }
    if (lines.length > maxLines) {
        runtime.gui.drawString(
            `... ${lines.length - maxLines} more line(s)`,
            x,
            y + (maxLines - 1) * lineH,
            Colors.muted
        );
    }
}

type PreviewLine = { text: string; color: number };

function previewLines(importable: Importable, charsPerLine: number): PreviewLine[] {
    const lines: PreviewLine[] = [];
    if (importable.type === "FUNCTION") {
        if (importable.repeatTicks !== undefined) {
            lines.push({
                text: `repeatTicks: ${importable.repeatTicks}`,
                color: Colors.muted,
            });
        }
        if (importable.icon !== undefined) {
            const count = importable.icon.count ?? 1;
            lines.push({
                text: `icon: ${importable.icon.item} x${count}`,
                color: Colors.muted,
            });
        }
        lines.push({ text: "", color: Colors.muted });
        appendActionsSource(lines, importable.actions, charsPerLine);
    } else if (importable.type === "EVENT") {
        lines.push({ text: `event: ${importable.event}`, color: Colors.muted });
        lines.push({ text: "", color: Colors.muted });
        appendActionsSource(lines, importable.actions, charsPerLine);
    } else if (importable.type === "REGION") {
        const f = importable.bounds.from;
        const t = importable.bounds.to;
        lines.push({
            text: `from: ${f.x}, ${f.y}, ${f.z}`,
            color: Colors.text,
        });
        lines.push({
            text: `to:   ${t.x}, ${t.y}, ${t.z}`,
            color: Colors.text,
        });
        if (importable.onEnterActions && importable.onEnterActions.length > 0) {
            lines.push({ text: "", color: Colors.muted });
            lines.push({ text: "// onEnter:", color: Colors.accent });
            appendActionsSource(lines, importable.onEnterActions, charsPerLine);
        }
        if (importable.onExitActions && importable.onExitActions.length > 0) {
            lines.push({ text: "", color: Colors.muted });
            lines.push({ text: "// onExit:", color: Colors.accent });
            appendActionsSource(lines, importable.onExitActions, charsPerLine);
        }
    } else if (importable.type === "ITEM") {
        lines.push({ text: `name: ${importable.name}`, color: Colors.muted });
        lines.push({ text: "", color: Colors.muted });
        const nbtSummary = summarizeNbt(importable.nbt);
        for (let i = 0; i < nbtSummary.length; i++) {
            lines.push({ text: nbtSummary[i], color: Colors.text });
        }
        if (importable.leftClickActions && importable.leftClickActions.length > 0) {
            lines.push({ text: "", color: Colors.muted });
            lines.push({ text: "// onLeftClick:", color: Colors.accent });
            appendActionsSource(lines, importable.leftClickActions, charsPerLine);
        }
        if (importable.rightClickActions && importable.rightClickActions.length > 0) {
            lines.push({ text: "", color: Colors.muted });
            lines.push({ text: "// onRightClick:", color: Colors.accent });
            appendActionsSource(lines, importable.rightClickActions, charsPerLine);
        }
    } else if (importable.type === "NPC") {
        lines.push({
            text: `pos: ${importable.pos.x}, ${importable.pos.y}, ${importable.pos.z}`,
            color: Colors.text,
        });
        if (importable.skin) {
            lines.push({ text: `skin: ${importable.skin}`, color: Colors.muted });
        }
        if (importable.equipment) {
            const e = importable.equipment;
            const parts: string[] = [];
            if (e.helmet) parts.push(`helm:${e.helmet}`);
            if (e.chestplate) parts.push(`chest:${e.chestplate}`);
            if (e.leggings) parts.push(`legs:${e.leggings}`);
            if (e.boots) parts.push(`boots:${e.boots}`);
            if (e.hand) parts.push(`hand:${e.hand}`);
            if (parts.length > 0) {
                lines.push({ text: "equipment:", color: Colors.muted });
                for (let i = 0; i < parts.length; i++) {
                    lines.push({ text: "  " + parts[i], color: Colors.text });
                }
            }
        }
        if (importable.leftClickActions && importable.leftClickActions.length > 0) {
            lines.push({ text: "", color: Colors.muted });
            lines.push({ text: "// onLeftClick:", color: Colors.accent });
            appendActionsSource(lines, importable.leftClickActions, charsPerLine);
        }
        if (importable.rightClickActions && importable.rightClickActions.length > 0) {
            lines.push({ text: "", color: Colors.muted });
            lines.push({ text: "// onRightClick:", color: Colors.accent });
            appendActionsSource(lines, importable.rightClickActions, charsPerLine);
        }
    } else if (importable.type === "MENU") {
        lines.push({
            text: `slots: ${importable.slots.length}` +
                (importable.size !== undefined ? `, size: ${importable.size}` : ""),
            color: Colors.muted,
        });
    }
    return lines;
}

function appendActionsSource(
    lines: PreviewLine[],
    actions: any[],
    charsPerLine: number
): void {
    let source = "";
    try {
        source = htsw.htsl.printActions(actions);
    } catch (error) {
        lines.push({
            text: `// preview unavailable: ${String(error)}`,
            color: Colors.red,
        });
        return;
    }
    const rawLines = source.split(/\r?\n/);
    for (let i = 0; i < rawLines.length; i++) {
        const raw = rawLines[i];
        if (raw.length <= charsPerLine) {
            lines.push({ text: raw, color: Colors.text });
        } else {
            // Soft-wrap by character count.
            let cursor = 0;
            while (cursor < raw.length) {
                lines.push({
                    text: raw.slice(cursor, cursor + charsPerLine),
                    color: Colors.text,
                });
                cursor += charsPerLine;
            }
        }
    }
}

function summarizeNbt(nbt: any): string[] {
    const out: string[] = [];
    try {
        appendTagLines(nbt, "", out, 0, 64);
        if (out.length === 0) out.push("(empty)");
    } catch (error) {
        out.push(`(nbt preview failed: ${String(error)})`);
    }
    return out;
}

function appendTagLines(
    tag: any,
    indent: string,
    out: string[],
    depth: number,
    cap: number
): void {
    if (out.length >= cap) return;
    if (tag === null || tag === undefined) {
        out.push(`${indent}null`);
        return;
    }
    if (typeof tag !== "object") {
        out.push(`${indent}${String(tag)}`);
        return;
    }
    if (!("kind" in tag)) {
        out.push(`${indent}${JSON.stringify(tag)}`);
        return;
    }
    const node = tag as { kind: string; entries?: any[]; value?: unknown; items?: any[] };
    if (node.kind === "compound" && Array.isArray(node.entries)) {
        out.push(`${indent}{`);
        const next = indent + "  ";
        for (let i = 0; i < node.entries.length && out.length < cap; i++) {
            const entry = node.entries[i];
            const child = entry.value;
            if (
                child &&
                typeof child === "object" &&
                "kind" in child &&
                ((child.kind === "compound" && Array.isArray(child.entries)) ||
                    (child.kind === "list" && Array.isArray(child.items)))
            ) {
                if (depth < 4) {
                    out.push(`${next}${entry.key}:`);
                    appendTagLines(child, next + "  ", out, depth + 1, cap);
                } else {
                    out.push(`${next}${entry.key}: ${tagInline(child)}`);
                }
            } else {
                out.push(`${next}${entry.key}: ${tagInline(child)}`);
            }
        }
        if (out.length < cap) out.push(`${indent}}`);
        return;
    }
    if (node.kind === "list" && Array.isArray(node.items)) {
        if (node.items.length === 0) {
            out.push(`${indent}[]`);
            return;
        }
        out.push(`${indent}[`);
        const next = indent + "  ";
        for (let i = 0; i < node.items.length && out.length < cap; i++) {
            appendTagLines(node.items[i], next, out, depth + 1, cap);
        }
        if (out.length < cap) out.push(`${indent}]`);
        return;
    }
    out.push(`${indent}${tagInline(node)}`);
}

function tagInline(tag: any): string {
    if (tag === null || tag === undefined) return "null";
    if (typeof tag !== "object") return String(tag);
    if (!("kind" in tag)) return JSON.stringify(tag);
    const node = tag as { kind: string; value?: unknown; entries?: any[]; items?: any[] };
    if (node.kind === "string") return JSON.stringify(node.value);
    if (node.kind === "compound" && Array.isArray(node.entries)) {
        return `{${node.entries.length} keys}`;
    }
    if (node.kind === "list" && Array.isArray(node.items)) {
        return `[${node.items.length}]`;
    }
    if (node.value !== undefined) return String(node.value);
    return `<${node.kind}>`;
}

type PreviewBtn =
    | { kind: "cmd"; label: string; tooltip: string; cmd: string }
    | { kind: "copyNbt"; label: string; tooltip: string; rowId: string }
    | { kind: "giveItem"; label: string; tooltip: string; rowId: string }
    | { kind: "openHtsl"; label: string; tooltip: string; rowId: string };

function drawPreviewActions(
    runtime: DashboardRuntime,
    row: DashboardRow,
    x: number,
    y: number,
    w: number
): void {
    const buttons = previewActionButtons(row);
    if (buttons.length === 0) return;
    const fixedW = 96;
    const gap = 6;
    let cursor = 0;
    const visible: PreviewBtn[] = [];
    for (let i = 0; i < buttons.length; i++) {
        const next = cursor === 0 ? fixedW : cursor + gap + fixedW;
        if (next > w) break;
        cursor = next;
        visible.push(buttons[i]);
    }
    let cx = x;
    for (let i = 0; i < visible.length; i++) {
        const b = visible[i];
        const rect = { x: cx, y, w: fixedW, h: Heights.actionButton };
        drawButton(runtime.gui, rect, b.label, true, isHovered(runtime, rect));
        if (b.kind === "cmd") {
            runtime.clickTargets.push({ kind: "previewCmd", cmd: b.cmd, rect });
        } else if (b.kind === "copyNbt") {
            runtime.clickTargets.push({ kind: "previewCopyNbt", rowId: b.rowId, rect });
        } else if (b.kind === "giveItem") {
            runtime.clickTargets.push({ kind: "previewGiveItem", rowId: b.rowId, rect });
        } else if (b.kind === "openHtsl") {
            runtime.clickTargets.push({ kind: "openHtslTab", rowId: b.rowId, rect });
        }
        pushTooltip(runtime, rect, b.tooltip);
        cx += fixedW + gap;
    }
}

function previewActionButtons(row: DashboardRow): PreviewBtn[] {
    const out: PreviewBtn[] = [];
    const importable = row.importable;
    if (importable.type === "FUNCTION") {
        out.push({
            kind: "cmd",
            label: `${Glyphs.edit} Edit`,
            tooltip: `Run /function edit ${importable.name}`,
            cmd: `/function edit ${importable.name}`,
        });
        out.push({
            kind: "openHtsl",
            label: `${Glyphs.file} .htsl`,
            tooltip: "Open the printed HTSL source in a new tab.",
            rowId: row.id,
        });
    } else if (importable.type === "EVENT") {
        out.push({
            kind: "cmd",
            label: `${Glyphs.edit} Edit`,
            tooltip: "Run /eventactions",
            cmd: "/eventactions",
        });
        out.push({
            kind: "openHtsl",
            label: `${Glyphs.file} .htsl`,
            tooltip: "Open the printed HTSL source in a new tab.",
            rowId: row.id,
        });
    } else if (importable.type === "REGION") {
        out.push({
            kind: "cmd",
            label: `${Glyphs.edit} Edit`,
            tooltip: `Run /region edit ${importable.name}`,
            cmd: `/region edit ${importable.name}`,
        });
        const f = importable.bounds.from;
        out.push({
            kind: "cmd",
            label: `${Glyphs.open} TP`,
            tooltip: `/tp ${f.x} ${f.y} ${f.z}`,
            cmd: `/tp ${f.x} ${f.y} ${f.z}`,
        });
    } else if (importable.type === "MENU") {
        out.push({
            kind: "cmd",
            label: `${Glyphs.edit} Edit`,
            tooltip: `Run /menu edit ${importable.name}`,
            cmd: `/menu edit ${importable.name}`,
        });
    } else if (importable.type === "NPC") {
        const p = importable.pos;
        out.push({
            kind: "cmd",
            label: `${Glyphs.open} TP`,
            tooltip: `/tp ${p.x} ${p.y} ${p.z}`,
            cmd: `/tp ${p.x} ${p.y} ${p.z}`,
        });
    } else if (importable.type === "ITEM") {
        out.push({
            kind: "giveItem",
            label: `${Glyphs.add} Give`,
            tooltip: "Spawn this item into your inventory (creative inject).",
            rowId: row.id,
        });
        out.push({
            kind: "copyNbt",
            label: "Copy NBT",
            tooltip: "Copy SNBT of item to clipboard.",
            rowId: row.id,
        });
    }
    return out;
}

function drawEmptyTable(
    runtime: DashboardRuntime,
    x: number,
    y: number,
    width: number
): void {
    runtime.gui.drawString(emptyTableText(runtime), x, y, Colors.muted);
    const blocking = runtime.state.diagnostics.filter(isBlockingDiagnostic);
    let lineY = y + 18;
    for (let i = 0; i < blocking.length && i < 6; i++) {
        runtime.gui.drawString(
            trimText(diagnosticSummary(blocking[i]), Math.max(24, Math.floor(width / 6))),
            x,
            lineY,
            Colors.red
        );
        lineY += 12;
    }
    if (blocking.length > 6) {
        runtime.gui.drawString(`... ${blocking.length - 6} more`, x, lineY, Colors.red);
    }
}

function drawBottomBar(runtime: DashboardRuntime, width: number, height: number): void {
    const mutatingEnabled = canMutate(runtime);
    const selected = selectedRows(runtime);
    const panelY = height - BOTTOM_BAR_H - 4;
    drawPanel({ x: 8, y: panelY, w: width - 16, h: BOTTOM_BAR_H });
    const buttonY = panelY + Math.floor((BOTTOM_BAR_H - Heights.actionButton) / 2);

    const startX = 18;
    const endX = width - 18;
    const children: LayoutChild[] = [
        { kind: "fixed", w: 124 }, // Import Selected
        { kind: "fixed", w: 100 }, // Diff Import
        { kind: "fixed", w: 122 }, // Forget
        { kind: "flex", minW: 8 }, // spacer
        { kind: "fixed", w: 110 }, // Select Visible
    ];
    const rects = layoutRow(startX, endX, buttonY, Heights.actionButton, 8, children);

    button(
        runtime,
        "importSelected",
        `${Glyphs.add} Import Selected`,
        rects[0],
        mutatingEnabled
    );
    pushTooltip(runtime, rects[0], "Imports only checked rows.");

    button(
        runtime,
        "importDirty",
        `${Glyphs.refresh} Diff Import`,
        rects[1],
        mutatingEnabled
    );
    pushTooltip(
        runtime,
        rects[1],
        "Imports rows whose source differs from cached knowledge, or which have no cache yet."
    );

    button(
        runtime,
        "forget",
        runtime.pendingForget
            ? `${Glyphs.remove} Confirm Forget`
            : `${Glyphs.remove} Forget Selected`,
        rects[2],
        runtime.state.housingUuid !== null && selected.length > 0
    );
    pushTooltip(runtime, rects[2], "Delete cached knowledge for selected rows.");

    button(runtime, "selectVisible", `[x] Select Visible`, rects[4]);
    pushTooltip(runtime, rects[4], "Toggle selection of all currently filtered rows.");

    // Status line above the action bar.
    const statusY = panelY - STATUS_LINE_H + 2;
    const statusText = runtime.state.statusMessage ?? statusSummary(runtime);
    runtime.gui.drawString(
        trimText(statusText, Math.max(24, Math.floor((width - 36) / 6))),
        18,
        statusY,
        Colors.muted
    );
}

function drawBrowser(runtime: DashboardRuntime, width: number, height: number): void {
    const rect = { x: 52, y: 60, w: width - 104, h: height - 118 };
    Renderer.drawRect(0xf4111419, rect.x, rect.y, rect.w, rect.h);
    Renderer.drawRect(0xff596270, rect.x, rect.y, rect.w, 1);

    runtime.clickTargets.push({ kind: "browserBackground", rect });

    runtime.gui.drawString("Browser", rect.x + 10, rect.y + 8, Colors.accent);

    const toolbarY = rect.y + 6;
    const toolbarStart = rect.x + 64;
    const toolbarEnd = rect.x + rect.w - 8;
    const importJsonExists = runtime.browserEntries.some(
        (entry) => entry.kind === "importJson"
    );

    const toolbarChildren: LayoutChild[] = [
        { kind: "fixed", w: 22 }, // refresh
        { kind: "fixed", w: 50 }, // up
        { kind: "fixed", w: 80 }, // open in OS
        { kind: "fixed", w: 80 }, // new file
        { kind: "fixed", w: 90 }, // new folder
        { kind: "fixed", w: 110 }, // init import.json
        { kind: "flex", minW: 4 }, // spacer
        { kind: "fixed", w: 60 }, // close
    ];
    const tb = layoutRow(
        toolbarStart,
        toolbarEnd,
        toolbarY,
        Heights.actionButton,
        4,
        toolbarChildren
    );

    button(runtime, "browserRefresh", Glyphs.refresh, tb[0]);
    pushTooltip(runtime, tb[0], "Re-list directory entries.");
    button(runtime, "browserUp", `${Glyphs.up} Up`, tb[1]);
    pushTooltip(runtime, tb[1], "Go to parent directory.");
    button(runtime, "browserOpenInOS", `${Glyphs.open} Open in OS`, tb[2]);
    pushTooltip(runtime, tb[2], "Open this directory in your OS file explorer.");
    button(runtime, "browserNewFile", `${Glyphs.add} New File`, tb[3]);
    pushTooltip(runtime, tb[3], "Create an empty file in this directory.");
    button(runtime, "browserNewFolder", `${Glyphs.add} New Folder`, tb[4]);
    pushTooltip(runtime, tb[4], "Create a subdirectory here.");
    button(
        runtime,
        "browserInitImport",
        `${Glyphs.init} Init import.json`,
        tb[5],
        !importJsonExists
    );
    pushTooltip(
        runtime,
        tb[5],
        importJsonExists
            ? "An import.json already exists in this directory."
            : "Create an empty import.json template here."
    );
    button(runtime, "browserClose", `${Glyphs.remove} Close`, tb[7]);
    pushTooltip(runtime, tb[7], "Close the browser.");

    const pathRect = {
        x: rect.x + 10,
        y: rect.y + 6 + Heights.actionButton + 6,
        w: rect.w - 20,
        h: Heights.field,
    };
    const pathField = field(
        runtime,
        "browserPath",
        "directory",
        runtime.browserDir,
        pathRect
    );
    drawTextField(
        runtime.gui,
        pathField,
        runtime.focusedField === "browserPath",
        isHovered(runtime, pathField.rect)
    );

    const listTop = pathRect.y + Heights.field + 6;
    const listBottom = rect.y + rect.h - 8;
    const rowH = 18;
    const visibleEntries = Math.max(0, Math.floor((listBottom - listTop) / rowH));
    const entries = runtime.browserEntries.slice(0, visibleEntries);
    let rowY = listTop;
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const entryRect = { x: rect.x + 10, y: rowY, w: rect.w - 20, h: rowH - 2 };
        Renderer.drawRect(
            isHovered(runtime, entryRect)
                ? Colors.hover
                : entry.kind === "directory"
                  ? Colors.rowSelected
                  : entry.kind === "importJson"
                    ? Colors.row
                    : Colors.row,
            entryRect.x,
            entryRect.y,
            entryRect.w,
            entryRect.h
        );
        const prefix =
            entry.kind === "directory"
                ? Glyphs.folder + " "
                : entry.kind === "importJson"
                  ? Glyphs.init + " "
                  : Glyphs.file + " ";
        const labelColor =
            entry.kind === "file"
                ? Colors.muted
                : entry.kind === "importJson"
                  ? Colors.accent
                  : Colors.text;
        runtime.gui.drawString(
            prefix + trimText(entry.name, Math.max(8, Math.floor((entryRect.w - 16) / 6))),
            entryRect.x + 5,
            entryRect.y + 5,
            labelColor
        );
        runtime.clickTargets.push({ kind: "browser", entry, rect: entryRect });
        rowY += rowH;
    }
}

function drawConfirm(runtime: DashboardRuntime, width: number, height: number): void {
    const rect = { x: width / 2 - 130, y: height / 2 - 36, w: 260, h: 72 };
    Renderer.drawRect(0xf2202026, rect.x, rect.y, rect.w, rect.h);
    Renderer.drawRect(0xff596270, rect.x, rect.y, rect.w, 1);
    runtime.gui.drawString(
        `Forget ${selectedRows(runtime).length} selected knowledge entries?`,
        rect.x + 12,
        rect.y + 14,
        Colors.text
    );
    const buttonY = rect.y + rect.h - Heights.actionButton - 10;
    button(runtime, "forgetConfirm", `${Glyphs.remove} Forget`, {
        x: rect.x + 24,
        y: buttonY,
        w: 90,
        h: Heights.actionButton,
    });
    button(runtime, "forgetCancel", "Cancel", {
        x: rect.x + rect.w - 24 - 90,
        y: buttonY,
        w: 90,
        h: Heights.actionButton,
    });
}

function drawPrompt(
    runtime: DashboardRuntime,
    prompt: PromptState,
    width: number,
    height: number
): void {
    const rect = { x: width / 2 - 160, y: height / 2 - 44, w: 320, h: 88 };
    Renderer.drawRect(0xf2202026, rect.x, rect.y, rect.w, rect.h);
    Renderer.drawRect(0xff596270, rect.x, rect.y, rect.w, 1);
    runtime.gui.drawString(prompt.title, rect.x + 12, rect.y + 12, Colors.text);
    const valueRect = {
        x: rect.x + 12,
        y: rect.y + 28,
        w: rect.w - 24,
        h: Heights.field,
    };
    const valueField = field(
        runtime,
        "promptValue",
        prompt.kind === "newFolder" ? "folder name" : "file name",
        prompt.value,
        valueRect
    );
    drawTextField(
        runtime.gui,
        valueField,
        runtime.focusedField === "promptValue",
        isHovered(runtime, valueField.rect)
    );

    const buttonY = rect.y + rect.h - Heights.actionButton - 10;
    button(runtime, "promptOk", "OK", {
        x: rect.x + 24,
        y: buttonY,
        w: 90,
        h: Heights.actionButton,
    });
    button(runtime, "promptCancel", "Cancel", {
        x: rect.x + rect.w - 24 - 90,
        y: buttonY,
        w: 90,
        h: Heights.actionButton,
    });
}

function drawContextMenu(runtime: DashboardRuntime): void {
    const menu = runtime.contextMenu;
    if (menu === null) return;
    const itemH = Heights.compactButton;
    const itemPadX = 12;
    let maxLabelLen = 0;
    for (let i = 0; i < menu.items.length; i++) {
        if (menu.items[i].label.length > maxLabelLen) maxLabelLen = menu.items[i].label.length;
    }
    const w = Math.min(260, maxLabelLen * 6 + itemPadX * 2);
    const h = menu.items.length * itemH + 4;
    const screenW = Renderer.screen.getWidth();
    const screenH = Renderer.screen.getHeight();
    const x = Math.min(menu.x, screenW - w - 4);
    const y = Math.min(menu.y, screenH - h - 4);

    Renderer.drawRect(0xf2202026, x, y, w, h);
    Renderer.drawRect(0xff596270, x, y, w, 1);

    let cursor = y + 2;
    for (let i = 0; i < menu.items.length; i++) {
        const item = menu.items[i];
        const itemRect = { x: x + 2, y: cursor, w: w - 4, h: itemH };
        const hovered = isHovered(runtime, itemRect);
        Renderer.drawRect(
            hovered && item.enabled ? Colors.hover : Colors.row,
            itemRect.x,
            itemRect.y,
            itemRect.w,
            itemRect.h
        );
        runtime.gui.drawString(
            item.label,
            itemRect.x + 8,
            itemRect.y + 6,
            item.enabled ? Colors.text : Colors.muted
        );
        runtime.clickTargets.push({
            kind: "contextItem",
            id: item.id,
            payload: item.payload,
            rect: itemRect,
            enabled: item.enabled,
        });
        cursor += itemH;
    }
}

function pushTooltip(runtime: DashboardRuntime, rect: Rect, text: string): void {
    runtime.clickTargets.push({ kind: "tooltipSource", text, rect });
}

function drainTooltipSources(runtime: DashboardRuntime): void {
    // Walk targets in render order; the topmost (last) tooltipSource under the
    // cursor wins. Other click-target kinds are ignored here.
    let chosen: string | null = null;
    for (let i = 0; i < runtime.clickTargets.length; i++) {
        const target = runtime.clickTargets[i];
        if (target.kind !== "tooltipSource") continue;
        if (contains(target.rect, runtime.mouseX, runtime.mouseY)) {
            chosen = target.text;
        }
    }
    if (chosen !== null) {
        runtime.tooltips.push({ x: runtime.mouseX + 12, y: runtime.mouseY + 12, text: chosen });
    }
}

function field(
    runtime: DashboardRuntime,
    id: string,
    label: string,
    value: string,
    rect: Rect,
    displayValue?: string
): TextField {
    const textField = { id, label, value, rect, displayValue };
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
    drawButton(runtime.gui, rect, label, enabled, isHovered(runtime, rect));
    runtime.clickTargets.push({ kind: "button", id, rect, enabled });
}

function toggle(
    runtime: DashboardRuntime,
    id: string,
    label: string,
    on: boolean,
    rect: Rect
): void {
    drawToggle(runtime.gui, rect, label, on, isHovered(runtime, rect));
    runtime.clickTargets.push({ kind: "button", id, rect, enabled: true });
}

function isHovered(runtime: DashboardRuntime, rect: Rect): boolean {
    return contains(rect, runtime.mouseX, runtime.mouseY);
}

function statusSummary(runtime: DashboardRuntime): string {
    const selected = selectedRows(runtime).length;
    const counts = { current: 0, modified: 0, unknown: 0 };
    for (let i = 0; i < runtime.state.rows.length; i++) {
        const row = runtime.state.rows[i];
        counts[row.knowledgeState]++;
    }
    return `${runtime.state.rows.length} rows · ${selected} selected · ${counts.current} current · ${counts.modified} modified · ${counts.unknown} unknown`;
}

function emptyTableText(runtime: DashboardRuntime): string {
    if (runtime.state.parseStatus.kind === "error")
        return runtime.state.parseStatus.message;
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

export function buildBrowserBackgroundContextMenuItems(
    runtime: DashboardRuntime
): ContextMenuItem[] {
    const dir = runtime.browserDir;
    const importJsonExists = runtime.browserEntries.some(
        (entry) => entry.kind === "importJson"
    );
    return [
        { id: "ctx.newFile", label: `${Glyphs.add} New File`, enabled: true, payload: dir },
        { id: "ctx.newFolder", label: `${Glyphs.add} New Folder`, enabled: true, payload: dir },
        {
            id: "ctx.initImport",
            label: `${Glyphs.init} Init import.json here`,
            enabled: !importJsonExists,
            payload: dir,
        },
        { id: "ctx.openInOS", label: `${Glyphs.open} Open in OS`, enabled: true, payload: dir },
    ];
}

export function buildBrowserEntryContextMenuItems(
    entry: { kind: "directory" | "importJson" | "file"; absolutePath: string }
): ContextMenuItem[] {
    const items: ContextMenuItem[] = [];
    if (entry.kind === "directory") {
        items.push({
            id: "ctx.openEntry",
            label: `${Glyphs.folder} Open`,
            enabled: true,
            payload: entry.absolutePath,
        });
        items.push({
            id: "ctx.initImport",
            label: `${Glyphs.init} Init import.json inside`,
            enabled: true,
            payload: entry.absolutePath,
        });
        items.push({
            id: "ctx.openInOS",
            label: `${Glyphs.open} Open in OS`,
            enabled: true,
            payload: entry.absolutePath,
        });
    } else {
        items.push({
            id: "ctx.openEntry",
            label: `${Glyphs.file} Load`,
            enabled: true,
            payload: entry.absolutePath,
        });
    }
    items.push({
        id: "ctx.delete",
        label: `${Glyphs.remove} Delete`,
        enabled: true,
        payload: entry.absolutePath,
    });
    return items;
}
