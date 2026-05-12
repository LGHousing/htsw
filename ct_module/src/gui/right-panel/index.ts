/// <reference types="../../../CTAutocomplete" />

import { ClickInfo, Element, Rect } from "../lib/layout";
import { Button, Col, Container, Icon, Row, Scroll, Text } from "../lib/components";
import { Icons, IconName } from "../lib/icons.generated";
import {
    closeTab,
    confirmSelect,
    getActivePath,
    getActiveRightTab,
    getTabs,
    moveTab,
    moveTabToEnd,
    moveTabToStart,
    setActiveRightTab,
    setActiveTab,
    Tab,
    tabIndex,
    tabCount,
    type RightPanelTabId,
} from "../state/selection";
import { openMenu, MenuAction } from "../lib/menu";
import { closeAllPopovers, togglePopover } from "../lib/popovers";
import {
    ACCENT_SUCCESS,
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_BUTTON_DANGER,
    COLOR_BUTTON_DANGER_HOVER,
    COLOR_BUTTON_PRIMARY,
    COLOR_BUTTON_PRIMARY_HOVER,
    COLOR_PANEL_BORDER,
    COLOR_PANEL_RAISED,
    COLOR_ROW,
    COLOR_ROW_HOVER,
    COLOR_ROW_SELECTED,
    COLOR_ROW_SELECTED_HOVER,
    COLOR_TAB,
    COLOR_TAB_ACCENT,
    COLOR_TAB_ACTIVE,
    COLOR_TAB_ACTIVE_HOVER,
    COLOR_TAB_HOVER,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
    SIZE_ROW_H,
    SIZE_TAB_H,
} from "../lib/theme";
import { diffKey, getDiffEntry } from "../state/diff";
import {
    getCheckedImportableCount,
    getCurrentImportingPath,
    getExportImportJsonPath,
    getHousingUuid,
    getImportEtaSeconds,
    getImportRunState,
    getImportStartedAt,
    getImportJsonPath,
    getImportProgress,
    getImportProgressFraction,
    isCurrentHouseTrusted,
    setExportImportJsonPath,
    setHouseTrust,
} from "../state";
import { getAlias } from "../../knowledge/aliases";
import { openAliasPopover } from "../popovers/alias";
import {
    clearQueue,
    addToQueue,
    getQueue,
    getQueueLength,
    queueItemKey,
    removeFromQueueKey,
    type QueueItem,
} from "../state/queue";
import { TaskManager } from "../../tasks/manager";
import { normalizeHtswPath } from "../lib/pathDisplay";
import { openFileBrowserWithImportJsonSelection } from "../popovers/file-browser";
import { addRecent, getRecents } from "../state/recents";
import { forEachCachedParse } from "../state/parses";
import { composeFileMenu } from "../state/fileMenu";
import {
    CAPTURE_TYPES,
    queueItemsForCheckedKeys,
    startCaptureExport,
    startImport,
} from "./import-actions";
import { clearImportableChecks, getCheckedImportableKeys } from "../state";
import { viewBody } from "./view-body";
import { livePreviewBody } from "./live-preview-body";


const TAB_BG = 0xff2c323b | 0;
const TAB_BG_HOVER = 0xff3a4350 | 0;
const TAB_BG_ACTIVE = 0xff4a5566 | 0;
const TAB_BG_ACTIVE_HOVER = 0xff586477 | 0;

function stem(p: string): string {
    // Walk both separators — tab paths come straight from `gcx.sourceFiles`
    // which on Windows are absolute paths with backslashes. Splitting on `/`
    // alone leaves the whole `C:\…` path as the "basename" and the tab button
    // ends up showing the full Windows path instead of just the file stem.
    const fwd = p.lastIndexOf("/");
    const back = p.lastIndexOf("\\");
    const slash = fwd > back ? fwd : back;
    const base = slash < 0 ? p : p.substring(slash + 1);
    const dot = base.lastIndexOf(".");
    return dot <= 0 ? base : base.substring(0, dot);
}

function dirOfPath(p: string): string {
    const norm = p.split("\\").join("/");
    const slash = norm.lastIndexOf("/");
    if (slash <= 0) return ".";
    return norm.substring(0, slash);
}

function shortPath(p: string): string {
    const norm = normalizeHtswPath(p).split("\\").join("/");
    const parts = norm.split("/");
    if (parts.length <= 4) return norm;
    return `.../${parts.slice(parts.length - 4).join("/")}`;
}

function basename(p: string): string {
    const norm = p.split("\\").join("/");
    const slash = norm.lastIndexOf("/");
    return slash < 0 ? norm : norm.substring(slash + 1);
}

function selectExportImportJson(path: string): void {
    setExportImportJsonPath(path);
    addRecent(path);
}

function pushUniquePath(out: string[], path: string): void {
    const norm = normalizeHtswPath(path);
    for (let i = 0; i < out.length; i++) {
        if (out[i] === norm) return;
    }
    out.push(norm);
}

function currentExportDestinations(): string[] {
    const out: string[] = [];
    pushUniquePath(out, getImportJsonPath());
    forEachCachedParse((entry) => {
        pushUniquePath(out, entry.canonicalPath);
    });
    return out;
}

const TAB_H = 13;
const TAB_CLOSE_W = 11;
const TAB_LABEL_PAD_X = 5;
const TAB_W_BUFFER = 2;
const COLOR_TAB_CLOSE_BG_HOVER = 0x40e85c5c | 0;

function tabReorderActions(path: string): MenuAction[] {
    const idx = tabIndex(path);
    const total = tabCount();
    // Tab-specific extras pinned at the top; `composeFileMenu` appends
    // the universal generics (Add to queue / Show in explorer / Open with
    // VSCode) below a divider so the menu shape matches the left
    // panel's row right-click.
    const specific: MenuAction[] = [
        { label: "Move left", onClick: () => moveTab(path, -1) },
        { label: "Move right", onClick: () => moveTab(path, +1) },
        { kind: "separator" },
        { label: "Move to start", onClick: () => moveTabToStart(path) },
        { label: "Move to end", onClick: () => moveTabToEnd(path) },
        { kind: "separator" },
        { label: "Close tab", onClick: () => closeTab(path) },
    ];
    void idx;
    void total;
    return composeFileMenu(specific, path);
}

function tabButton(tab: Tab): Element {
    const isActive = getActivePath() === tab.path;
    const labelText = tab.confirmed ? stem(tab.path) : `§o${stem(tab.path)}`;
    const tabBg = isActive ? TAB_BG_ACTIVE : TAB_BG;
    const tabHoverBg = isActive ? TAB_BG_ACTIVE_HOVER : TAB_BG_HOVER;
    // Width sized to: label width + horizontal padding + close-glyph cell +
    // a tiny safety buffer (italic chars and `Renderer.getStringWidth`
    // occasionally undercount by a pixel, which would otherwise shave the
    // last char off a tightly-fitted label). Content-sized so the X sits
    // next to the label instead of floating to the far end of the row.
    const labelW = Renderer.getStringWidth(labelText);
    const tabW = labelW + TAB_LABEL_PAD_X * 2 + TAB_CLOSE_W + TAB_W_BUFFER;
    return Container({
        style: {
            direction: "row",
            align: "center",
            width: { kind: "px", value: tabW },
            height: { kind: "grow" },
            background: tabBg,
            hoverBackground: tabHoverBg,
        },
        onClick: (_rect: Rect, info: ClickInfo) => {
            if (info.button === 1) {
                openMenu(info.x, info.y, tabReorderActions(tab.path));
                return;
            }
            if (info.button !== 0) return;
            if (info.isDoubleClickSecond) confirmSelect(tab.path);
            else setActiveTab(tab.path);
        },
        children: [
            Container({
                style: {
                    direction: "row",
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    align: "center",
                    padding: { side: "x", value: TAB_LABEL_PAD_X },
                },
                children: [Text({ text: labelText })],
            }),
            // Close cell — direction:col + align/justify:center centers the
            // icon both ways inside the close cell.
            Container({
                style: {
                    direction: "col",
                    width: { kind: "px", value: TAB_CLOSE_W },
                    height: { kind: "grow" },
                    align: "center",
                    justify: "center",
                    hoverBackground: COLOR_TAB_CLOSE_BG_HOVER,
                },
                onClick: (_rect, info) => {
                    if (info.button !== 0) return;
                    closeTab(tab.path);
                },
                children: [Icon({ name: Icons.x })],
            }),
        ],
    });
}

function formatEtaSeconds(secs: number): string {
    const total = Math.max(0, Math.round(secs));
    if (total < 60) return `~${total}s`;
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m < 60) return s === 0 ? `~${m}m` : `~${m}m${s}s`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm === 0 ? `~${h}h` : `~${h}h${mm}m`;
}

function formatElapsedSeconds(secs: number): string {
    const total = Math.max(0, Math.floor(secs));
    if (total < 60) return `${total}s`;
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m < 60) return s === 0 ? `${m}m` : `${m}m${s}s`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm === 0 ? `${h}h` : `${h}h${mm}m`;
}

function progressEtaText(): string {
    const p = getImportProgress();
    const secs = getImportEtaSeconds();
    if (secs === null) return p === null ? "" : "calculating…";
    const text = formatEtaSeconds(secs);
    if (p !== null && p.etaConfidence === "rough") return `${text} rough`;
    if (p !== null && p.etaConfidence === "informed") return `${text} informed`;
    return text;
}

function progressElapsedText(): string {
    const startedAt = getImportStartedAt();
    if (startedAt === null) return "";
    return `elapsed ${formatElapsedSeconds((Date.now() - startedAt) / 1000)}`;
}

/** What's happening *right now* — pulled from the diff entry's per-action
 * label first (most specific), then the importer's phase-level label. */
function progressCurrentLabel(): string {
    const path = getCurrentImportingPath();
    if (path !== null) {
        const entry = getDiffEntry(diffKey(path));
        if (entry !== undefined && entry.currentLabel.length > 0) {
            return entry.currentLabel;
        }
    }
    const p = getImportProgress();
    if (p === null) return "";
    if (p.currentLabel.length > 0) return p.currentLabel;
    if (p.phaseLabel.length > 0) return p.phaseLabel;
    return "working";
}

/**
 * Render a path as `./htsw/...` when the path passes through the htsw repo,
 * else as `./...` relative to the MC root. No length-based truncation — the
 * scissor on the path-label container clips any overflow at the panel edge.
 */
function displayPath(p: string): string {
    return normalizeHtswPath(p);
}

function pathLabel(): Element {
    return Text({
        text: () => {
            const p = getActivePath();
            return p === null ? "" : displayPath(p);
        },
        color: 0xff888888 | 0,
        style: { width: { kind: "grow" } },
    });
}

// ── Top-level View/Import panel tabs ────────────────────────────────────

function panelTabButton(id: RightPanelTabId, label: string, icon: IconName): Element {
    const isActive = getActiveRightTab() === id;
    return Container({
        style: {
            direction: "col",
            width: { kind: "grow" },
            height: { kind: "grow" },
        },
        children: [
            Button({
                icon,
                text: label,
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: isActive ? COLOR_TAB_ACTIVE : COLOR_TAB,
                    hoverBackground: isActive ? COLOR_TAB_ACTIVE_HOVER : COLOR_TAB_HOVER,
                },
                onClick: () => {
                    setActiveRightTab(id);
                },
            }),
            Container({
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 2 },
                    background: isActive ? COLOR_TAB_ACCENT : undefined,
                },
                children: [],
            }),
        ],
    });
}

function panelTabBar(): Element {
    return Row({
        style: {
            gap: 2,
            height: { kind: "px", value: SIZE_TAB_H + 2 },
            width: { kind: "grow" },
        },
        children: [
            panelTabButton("view", "View", Icons.eye),
            panelTabButton("import", "Import", Icons.upload),
        ],
    });
}

// ── View tab (existing source preview + sub-tabs) ──────────────────────

function viewTab(): Element {
    return Col({
        style: { gap: 4, width: { kind: "grow" }, height: { kind: "grow" } },
        children: [
            Row({
                style: { gap: 2, height: { kind: "px", value: TAB_H } },
                children: () => getTabs().map(tabButton),
            }),
            pathLabel(),
            viewBody(),
        ],
    });
}

// ── Import tab (queue + live importer + capture/import buttons) ─────────

function shortSource(p: string): string {
    const norm = p.replace(/\\/g, "/");
    const slash = norm.lastIndexOf("/");
    return slash < 0 ? norm : norm.substring(slash + 1);
}

function queueRow(item: QueueItem): Element {
    const typeText =
        item.kind === "importJson" ? "ALL" : item.type;
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "x", value: 6 },
            gap: 6,
            height: { kind: "px", value: SIZE_ROW_H },
            background: COLOR_ROW,
            hoverBackground: COLOR_ROW_HOVER,
        },
        children: [
            Text({
                text: typeText,
                color: COLOR_TEXT_DIM,
                style: { width: { kind: "px", value: 48 } },
            }),
            Text({
                text: item.label,
                style: { width: { kind: "grow" } },
            }),
            Text({
                text: shortSource(item.sourcePath),
                color: COLOR_TEXT_FAINT,
            }),
            Container({
                style: {
                    direction: "col",
                    width: { kind: "px", value: 14 },
                    height: { kind: "grow" },
                    align: "center",
                    justify: "center",
                    hoverBackground: 0x40e85c5c | 0,
                },
                onClick: (_rect, info) => {
                    if (info.button !== 0) return;
                    removeFromQueueKey(queueItemKey(item));
                },
                children: [Icon({ name: Icons.x })],
            }),
        ],
    });
}

// ── Collapsible queue summary (Now: X / Next: Y) ────────────────────────

// Per-session expansion toggle; resets between MC reloads. Default
// collapsed because the headline summary already conveys the state.
let queueExpanded = false;

function nextImportableLabel(): string | null {
    const run = getImportRunState();
    const progress = getImportProgress();
    if (run === null || progress === null) return null;
    let idx = -1;
    for (let i = 0; i < run.order.length; i++) {
        if (run.order[i] === progress.currentKey) { idx = i; break; }
    }
    if (idx < 0 || idx + 1 >= run.order.length) return null;
    const next = run.rows.get(run.order[idx + 1]);
    return next === undefined ? null : next.identity;
}

function nowSummaryText(): string {
    const progress = getImportProgress();
    if (progress !== null) {
        const label = progress.currentIdentity.length === 0
            ? "starting…"
            : progress.currentIdentity;
        return `Now: ${label}`;
    }
    const n = getQueueLength();
    if (n === 0) return "Queue (empty)";
    return `Queue (${n})`;
}

function nextSummaryText(): string {
    const progress = getImportProgress();
    if (progress === null) {
        // Not importing — preview the first queue item as "Next" if any.
        const items = getQueue();
        if (items.length === 0) return "";
        return `Next: ${items[0].label}`;
    }
    const next = nextImportableLabel();
    return next === null ? "Next: Done!" : `Next: ${next}`;
}

/**
 * Compact one-line queue header. Chevron toggles full list visibility.
 * "Now: X / Next: Y" during an import; "Queue (N) / Next: <first>" when idle.
 */
function queueSummary(): Element {
    return Row({
        style: { gap: 4, height: { kind: "px", value: 18 }, align: "center" },
        children: [
            // Chevron — toggles the expanded queue list below.
            Container({
                style: {
                    direction: "col",
                    width: { kind: "px", value: 14 },
                    height: { kind: "grow" },
                    align: "center",
                    justify: "center",
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: () => { queueExpanded = !queueExpanded; },
                children: [
                    Icon({ name: () => queueExpanded ? Icons.chevronDown : Icons.chevronRight }),
                ],
            }),
            Text({
                text: () => nowSummaryText(),
                color: COLOR_TEXT,
                style: { width: { kind: "auto" } },
            }),
            Text({
                text: () => {
                    const t = nextSummaryText();
                    return t.length === 0 ? "" : `  ·  ${t}`;
                },
                color: COLOR_TEXT_DIM,
                style: { width: { kind: "grow" } },
            }),
            Button({
                text: "Clear",
                style: {
                    width: { kind: "px", value: 38 },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: () => clearQueue(),
            }),
        ],
    });
}

/**
 * Expanded queue list — visible only when `queueExpanded` is true. Bounded
 * height so the live preview below it still has room.
 */
function queueExpansion(): Element {
    return Scroll({
        id: "right-import-queue-scroll",
        style: {
            gap: 2,
            height: { kind: "px", value: 80 },
            background: COLOR_PANEL_RAISED,
        },
        children: () => {
            if (!queueExpanded) return [];
            const items = getQueue();
            if (items.length === 0) {
                return [
                    Container({
                        style: { padding: 6 },
                        children: [
                            Text({
                                text: "Queue is empty — right-click anything in Explore and Add to queue.",
                                color: COLOR_TEXT_FAINT,
                            }),
                        ],
                    }),
                ];
            }
            return items.map(queueRow);
        },
    });
}

const COLOR_BAR_BG = COLOR_PANEL_BORDER;
const COLOR_BAR_FG = ACCENT_SUCCESS;
const PROGRESS_BAR_H = 6;

function progressBar(): Element {
    return Container({
        style: {
            direction: "row",
            width: { kind: "grow" },
            height: { kind: "px", value: PROGRESS_BAR_H },
            background: COLOR_BAR_BG,
        },
        children: () => {
            const p = getImportProgress();
            if (p === null || p.weightTotal <= 0) return [];
            const ratio = getImportProgressFraction();
            return [
                Container({
                    style: {
                        width: { kind: "grow", factor: Math.max(0.0001, ratio) },
                        height: { kind: "grow" },
                        background: COLOR_BAR_FG,
                    },
                    children: [],
                }),
                Container({
                    style: {
                        width: { kind: "grow", factor: Math.max(0.0001, 1 - ratio) },
                        height: { kind: "grow" },
                    },
                    children: [],
                }),
            ];
        },
    });
}

function liveImporterPanel(): Element {
    return Container({
        style: {
            width: { kind: "grow" },
            padding: 4,
            background: COLOR_PANEL_RAISED,
        },
        children: () => {
            const p = getImportProgress();
            if (p === null) {
                return [
                    Text({
                        text: "No import in progress.",
                        color: COLOR_TEXT_DIM,
                    }),
                ];
            }
            return [
                Col({
                    style: { gap: 3, width: { kind: "grow" } },
                    children: [
                        // "Currently" header + bold action label — the
                        // primary read for the user.
                        Text({ text: "Currently", color: COLOR_TEXT_FAINT }),
                        Text({
                            text: () => `§l${progressCurrentLabel()}`,
                            color: COLOR_TEXT,
                        }),
                        // Phase + step counter + ETA on one line.
                        Text({
                            text: () => {
                                const prog = getImportProgress();
                                if (prog === null) return "";
                                const parts: string[] = [];
                                parts.push(`${prog.phase} · ${prog.phaseLabel}`);
                                if (prog.unitTotal > 0) {
                                    parts.push(`${prog.unitCompleted}/${prog.unitTotal}`);
                                }
                                parts.push(progressEtaText());
                                return parts.filter((s) => s.length > 0).join("  ·  ");
                            },
                            color: COLOR_TEXT_DIM,
                        }),
                        // Source file path (full htsw-relative form).
                        Text({
                            text: () => {
                                const path = getCurrentImportingPath();
                                return path === null ? "" : `→ ${normalizeHtswPath(path)}`;
                            },
                            color: COLOR_TEXT_FAINT,
                        }),
                        // Importable counter — which of N is currently active.
                        Text({
                            text: () =>
                                `${p.completed + 1}/${p.total} importable · ${p.currentIdentity}`,
                            color: COLOR_TEXT_FAINT,
                        }),
                        // Visual rule before the progress bar.
                        Container({
                            style: { width: { kind: "grow" }, height: { kind: "px", value: 2 } },
                            children: [],
                        }),
                        progressBar(),
                        Row({
                            style: { gap: 6, height: { kind: "px", value: 12 }, align: "center" },
                            children: [
                                Text({
                                    text: () =>
                                        `${Math.floor(getImportProgressFraction() * 100)}%`,
                                    color: COLOR_TEXT,
                                    style: { width: { kind: "grow" } },
                                }),
                                Text({
                                    text: () => progressElapsedText(),
                                    color: COLOR_TEXT_FAINT,
                                }),
                                Button({
                                    icon: Icons.x,
                                    text: "Cancel",
                                    style: {
                                        width: { kind: "auto" },
                                        height: { kind: "grow" },
                                        background: COLOR_BUTTON_DANGER,
                                        hoverBackground: COLOR_BUTTON_DANGER_HOVER,
                                    },
                                    onClick: () => {
                                        if (getImportProgress() === null) return;
                                        TaskManager.cancelAll();
                                        ChatLib.chat(`&c[htsw] cancelling import…`);
                                    },
                                }),
                            ],
                        }),
                    ],
                }),
            ];
        },
    });
}

function destinationSection(label: string): Element {
    return Text({
        text: label,
        color: COLOR_TEXT_FAINT,
        style: { padding: { side: "x", value: 4 } },
    });
}

function destinationRow(path: string): Element {
    const selected = normalizeHtswPath(path) === normalizeHtswPath(getExportImportJsonPath());
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "x", value: 8 },
            gap: 6,
            height: { kind: "px", value: SIZE_ROW_H },
            background: selected ? COLOR_ROW_SELECTED : COLOR_ROW,
            hoverBackground: selected ? COLOR_ROW_SELECTED_HOVER : COLOR_ROW_HOVER,
        },
        onClick: () => {
            selectExportImportJson(path);
            closeAllPopovers();
        },
        children: [
            Icon({ name: selected ? Icons.check : Icons.fileJson }),
            Text({
                text: basename(path),
                color: COLOR_TEXT,
                style: { width: { kind: "px", value: 96 } },
            }),
            Text({
                text: shortPath(path),
                color: COLOR_TEXT_DIM,
                style: { width: { kind: "grow" } },
            }),
        ],
    });
}

function captureDestinationPicker(): Element {
    const open = currentExportDestinations();
    const recents = getRecents();
    return Col({
        style: { gap: 3, padding: 4, height: { kind: "grow" } },
        children: [
            destinationSection("Open import.jsons"),
            ...open.map(destinationRow),
            destinationSection("Recent"),
            ...(recents.length === 0
                ? [
                      Text({
                          text: "(none)",
                          color: COLOR_TEXT_FAINT,
                          style: { padding: { side: "x", value: 8 } },
                      }),
                  ]
                : recents.map(destinationRow)),
            Button({
                icon: Icons.search,
                text: "Browse...",
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 20 },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: () => {
                    const current = getExportImportJsonPath();
                    closeAllPopovers();
                    openFileBrowserWithImportJsonSelection(
                        dirOfPath(current) || ".",
                        (path) => selectExportImportJson(path)
                    );
                },
            }),
        ],
    });
}

function captureMenuPopoverContent(): Element {
    return Col({
        style: { gap: 2, padding: 4 },
        children: [
            Row({
                style: { gap: 4, height: { kind: "px", value: SIZE_ROW_H } },
                children: [
                    Text({
                        text: () => shortPath(getExportImportJsonPath()),
                        color: COLOR_TEXT_DIM,
                        style: { width: { kind: "grow" } },
                    }),
                    Button({
                        text: "Change",
                        style: {
                            width: { kind: "px", value: 56 },
                            height: { kind: "grow" },
                            background: COLOR_BUTTON,
                            hoverBackground: COLOR_BUTTON_HOVER,
                        },
                        onClick: (rect) =>
                            togglePopover({
                                key: "right-capture-destination-menu",
                                anchor: rect,
                                content: captureDestinationPicker(),
                                width: 360,
                                height: 220,
                            }),
                    }),
                ],
            }),
            ...CAPTURE_TYPES.map((t) =>
                Container({
                    style: {
                        direction: "row",
                        align: "center",
                        padding: { side: "x", value: 8 },
                        gap: 6,
                        height: { kind: "px", value: SIZE_ROW_H },
                        background: COLOR_ROW,
                        hoverBackground: COLOR_ROW_HOVER,
                    },
                    onClick: () => startCaptureExport(t),
                    children: [
                        Text({
                            text: `Capture ${t}`,
                            color: COLOR_TEXT,
                            style: { width: { kind: "grow" } },
                        }),
                    ],
                })
            ),
        ],
    });
}

function importActionRow(): Element {
    return Row({
        style: { gap: 4, height: { kind: "px", value: 18 } },
        children: [
            Button({
                // Capture pulls from server → user, hence `download`. The
                // chevron-down keeps the "this opens a menu" affordance.
                children: [
                    Icon({ name: Icons.download }),
                    Text({ text: "Capture" }),
                    Icon({ name: Icons.chevronDown }),
                ],
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: (rect) =>
                    togglePopover({
                        key: "right-capture-type-menu",
                        anchor: rect,
                        content: captureMenuPopoverContent(),
                        width: 260,
                        height: (CAPTURE_TYPES.length + 1) * 20 + 8,
                    }),
            }),
            Button({
                icon: Icons.upload,
                text: () => {
                    const n = getQueueLength();
                    return n === 0 ? "Import" : `Import (${n})`;
                },
                style: {
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON_PRIMARY,
                    hoverBackground: COLOR_BUTTON_PRIMARY_HOVER,
                },
                onClick: () => startImport(),
            }),
            // Caret: alternate-source actions (run only the multi-selected
            // importables, clear the selection). Sized to match the
            // chevron-only buttons elsewhere in this row.
            Button({
                icon: Icons.chevronDown,
                style: {
                    width: { kind: "px", value: 22 },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON_PRIMARY,
                    hoverBackground: COLOR_BUTTON_PRIMARY_HOVER,
                },
                onClick: (rect) => {
                    togglePopover({
                        key: "right-import-caret-menu",
                        anchor: rect,
                        content: importCaretPopoverContent(),
                        width: 200,
                        height: 56,
                    });
                },
            }),
        ],
    });
}

function importCaretPopoverContent(): Element {
    return Col({
        style: { padding: 4, gap: 2, height: { kind: "grow" } },
        children: [
            Button({
                text: () => `Add selected to queue (${getCheckedImportableCount()})`,
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 20 },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: () => {
                    const items = queueItemsForCheckedKeys(getCheckedImportableKeys());
                    let added = 0;
                    for (let i = 0; i < items.length; i++) {
                        if (addToQueue(items[i])) added++;
                    }
                    closeAllPopovers();
                    ChatLib.chat(`&a[htsw] Added ${added} to queue.`);
                },
            }),
            Button({
                text: "Clear selection",
                style: {
                    width: { kind: "grow" },
                    height: { kind: "px", value: 20 },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: () => {
                    clearImportableChecks();
                    closeAllPopovers();
                },
            }),
        ],
    });
}

// Trust toggle colours mirror the Knowledge tab so the two surfaces read
// the same (green = on, blue = off). Kept local — too small to extract.
const TRUST_ON_BG = 0xff2d4d2d | 0;
const TRUST_ON_HOVER = 0xff3a5d3a | 0;
const TRUST_OFF_BG = 0xff2d333d | 0;
const TRUST_OFF_HOVER = 0xff3a4350 | 0;

function shortUuid(uuid: string): string {
    if (uuid.length <= 18) return uuid;
    return `${uuid.substring(0, 8)}…${uuid.substring(uuid.length - 6)}`;
}

function houseHeader(): Element {
    return Container({
        style: {
            direction: "row",
            align: "center",
            padding: { side: "x", value: 6 },
            gap: 6,
            height: { kind: "px", value: SIZE_ROW_H + 4 },
            background: COLOR_ROW,
        },
        children: [
            Text({
                text: "House:",
                color: COLOR_TEXT_DIM,
            }),
            Text({
                text: () => {
                    const uuid = getHousingUuid();
                    if (uuid === null) return "(unknown — open Knowledge tab to detect)";
                    const alias = getAlias(uuid);
                    return alias === null ? shortUuid(uuid) : alias;
                },
                color: COLOR_TEXT,
                style: { width: { kind: "grow" } },
            }),
            // Faded UUID tail when an alias is set, so the user can still
            // tell two aliases apart at a glance.
            Text({
                text: () => {
                    const uuid = getHousingUuid();
                    if (uuid === null) return "";
                    return getAlias(uuid) === null ? "" : shortUuid(uuid);
                },
                color: COLOR_TEXT_FAINT,
            }),
            Container({
                style: {
                    direction: "row",
                    align: "center",
                    padding: { side: "x", value: 6 },
                    gap: 4,
                    width: { kind: "px", value: 70 },
                    height: { kind: "grow" },
                    background: () => (isCurrentHouseTrusted() ? TRUST_ON_BG : TRUST_OFF_BG),
                    hoverBackground: () =>
                        isCurrentHouseTrusted() ? TRUST_ON_HOVER : TRUST_OFF_HOVER,
                },
                onClick: (_rect, info) => {
                    if (info.button !== 0) return;
                    const uuid = getHousingUuid();
                    if (uuid === null) return;
                    setHouseTrust(uuid, !isCurrentHouseTrusted());
                },
                children: [
                    Icon({
                        name: () =>
                            isCurrentHouseTrusted() ? Icons.shieldCheck : Icons.shield,
                    }),
                    Text({
                        text: "Trust",
                        color: COLOR_TEXT_DIM,
                        style: { width: { kind: "grow" } },
                    }),
                ],
            }),
            Button({
                icon: Icons.pencil,
                text: "Alias",
                style: {
                    width: { kind: "px", value: 56 },
                    height: { kind: "grow" },
                    background: COLOR_BUTTON,
                    hoverBackground: COLOR_BUTTON_HOVER,
                },
                onClick: (rect: Rect) => {
                    const uuid = getHousingUuid();
                    if (uuid === null) return;
                    openAliasPopover(rect, uuid);
                },
            }),
        ],
    });
}

function importTab(): Element {
    // Layout: house header (fixed) → collapsible queue summary (fixed) →
    // expanded queue list (fixed height, only when expanded) → live preview
    // (grow, the new scrollable file view) → live importer panel (shrinks
    // when import inactive) → action row (fixed).
    return Col({
        style: { gap: 4, width: { kind: "grow" }, height: { kind: "grow" } },
        children: [
            houseHeader(),
            queueSummary(),
            queueExpansion(),
            livePreviewBody(),
            liveImporterPanel(),
            importActionRow(),
        ],
    });
}

export function RightPanel(): Element {
    return Col({
        style: { padding: 6, gap: 4, width: { kind: "grow" }, height: { kind: "grow" } },
        children: () => [
            panelTabBar(),
            getActiveRightTab() === "view" ? viewTab() : importTab(),
        ],
    });
}

export const RightRail = RightPanel;
