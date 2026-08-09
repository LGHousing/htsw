/// <reference types="../../../CTAutocomplete" />

import { ClickInfo, Element, Rect } from "../lib/layout";
import { Button, Col, Container, Icon, Row, Scroll, Text } from "../lib/components";
import { Icons } from "../lib/icons.generated";
import {
    closeLiveTab,
    closeTab,
    confirmSelect,
    getActiveFileSelection,
    getActivePath,
    getTabs,
    isLiveTabActive,
    moveTabToEnd,
    moveTabToStart,
    selectLiveTab,
    setActiveTab,
    type Tab,
} from "./selection";
import { openMenu, MenuAction } from "../lib/menu";
import {
    ACCENT_TEAL,
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_TEXT_DIM,
    GLYPH_DOT,
    SIZE_ROW_H,
} from "../lib/theme";
import { statusForFile, STATUS_COLOR, STATUS_LABEL } from "../cache-status";
import { FileSystemFileLoader, StringFileLoader } from "../../utils/fileLoaders";
import * as htsw from "htsw";
import { viewBody } from "./view-body";
import { compactFileLabel, compactPath, hasExt } from "../lib/pathDisplay";
import { composeFileMenu } from "../menus/fileMenu";
import { viewFooter } from "./view-footer";
import { ImportCodeViewFollowButton } from "./importCodeView";
import {
    beginTabDrag,
    isTabDragging,
    updateTabDrag,
    TAB_STRIP_SCROLL_ID,
} from "./tabDrag";
import { canonicalPath } from "../parsing/parses";
import {
    getQueue,
    getQueuedItemKey,
    queueItemKey,
    queueItemsForPath,
    type QueueItem,
} from "./import-tab/queue";
import {
    getActiveTaskListLabel,
    getSessionVerb,
} from "./import-tab/taskProgress";

const TAB_BG = 0xff2c323b | 0;
const TAB_BG_HOVER = 0xff3a4350 | 0;
const TAB_BG_ACTIVE = 0xff4a5566 | 0;
const TAB_BG_ACTIVE_HOVER = 0xff586477 | 0;
const TAB_STRIP_BG = 0xff15181d | 0;
const TAB_EMPTY_TEXT = 0xff5c6371 | 0;
const TAB_BG_DRAGGING = 0xff526074 | 0;

const fileLoader = new FileSystemFileLoader();
type CachedFile = { mtime: number; lines: string[] };
const fileCache = new Map<string, CachedFile>();

export function rightPanelFileCacheSize(): number {
    return fileCache.size;
}

const TAB_H = 13;
const TAB_CLOSE_W = 11;
const TAB_LABEL_PAD_X = 5;
const TAB_W_BUFFER = 2;
const COLOR_TAB_CLOSE_BG_HOVER = 0x40e85c5c | 0;
const TAB_DOT_W = 8;
const TAB_ICON_W = 9;
const TAB_ICON_GAP = 3;
const TAB_ICON_SLOT_W = TAB_ICON_W + TAB_ICON_GAP;
const TAB_HANDLE_W = 9;
const TAB_HANDLE_GAP = 2;
const TAB_HANDLE_SLOT_W = TAB_HANDLE_W + TAB_HANDLE_GAP;

function tabActions(tab: Extract<Tab, { kind: "file" }>): MenuAction[] {
    if (!tab.confirmed) {
        return composeFileMenu(
            [
                {
                    label: "Pin tab",
                    onClick: () => confirmSelect(tab.path, tab.importJsonPath),
                },
                { kind: "separator" },
                {
                    label: "Close tab",
                    onClick: () => closeTab(tab.path, tab.importJsonPath),
                },
            ],
            tab.path,
            tab.importJsonPath
        );
    }
    const specific: MenuAction[] = [
        {
            label: "Move to start",
            onClick: () => moveTabToStart(tab.path, tab.importJsonPath),
        },
        {
            label: "Move to end",
            onClick: () => moveTabToEnd(tab.path, tab.importJsonPath),
        },
        { kind: "separator" },
        { label: "Close tab", onClick: () => closeTab(tab.path, tab.importJsonPath) },
    ];
    return composeFileMenu(specific, tab.path, tab.importJsonPath);
}

function liveTabMenu(): MenuAction[] {
    return [{ label: "Close tab", onClick: () => closeLiveTab() }];
}

function itemPath(item: QueueItem): string {
    return item.operation === "import" ? item.sourcePath : item.destinationPath;
}

function queuedCountForTab(tab: Extract<Tab, { kind: "file" }>): number {
    const matches = queueItemsForPath(tab.path, tab.importJsonPath);
    const seen = new Set<string>();
    let count = 0;
    for (let i = 0; i < matches.length; i++) {
        const key = getQueuedItemKey(matches[i]);
        if (key !== null && !seen.has(key)) {
            seen.add(key);
            count++;
        }
    }
    const canonical = canonicalPath(tab.path);
    const queue = getQueue();
    for (let i = 0; i < queue.length; i++) {
        const key = queueItemKey(queue[i]);
        if (canonicalPath(itemPath(queue[i])) === canonical && !seen.has(key)) {
            seen.add(key);
            count++;
        }
    }
    return count;
}

function tabButton(tab: Tab): Element {
    const isLive = tab.kind === "live";
    const activeFile = getActiveFileSelection();
    const isActive = isLive
        ? isLiveTabActive()
        : activeFile !== null &&
          activeFile.path === tab.path &&
          activeFile.importJsonPath === tab.importJsonPath;
    const labelText = isLive
        ? getSessionVerb() === "export"
            ? "§oExport"
            : getSessionVerb() === "read"
              ? "§oRead"
              : getSessionVerb() === "diff"
                ? "§oDiff"
                : `§o${compactFileLabel(tab.path)}`
        : tab.confirmed
          ? compactFileLabel(tab.path)
          : `§o${compactFileLabel(tab.path)}`;
    const isDraggable = !isLive && tab.confirmed;
    const tabBg =
        isDraggable && isTabDragging(tab.path, tab.importJsonPath)
            ? TAB_BG_DRAGGING
            : isActive
              ? TAB_BG_ACTIVE
              : TAB_BG;
    const tabHoverBg = isActive ? TAB_BG_ACTIVE_HOVER : TAB_BG_HOVER;
    const fileStatus = isLive ? null : statusForFile(tab.path, tab.importJsonPath);
    const hasDot = fileStatus !== null;
    const queuedCount = isLive ? 0 : queuedCountForTab(tab);
    const isQueued = queuedCount > 0;
    const labelW = Renderer.getStringWidth(labelText);
    const tabW =
        (hasDot ? TAB_DOT_W : 0) +
        (isDraggable ? TAB_HANDLE_SLOT_W : 0) +
        (isLive ? TAB_ICON_SLOT_W : 0) +
        (isQueued ? TAB_ICON_SLOT_W : 0) +
        labelW +
        TAB_LABEL_PAD_X * 2 +
        TAB_CLOSE_W +
        TAB_W_BUFFER;
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
                openMenu(
                    info.x,
                    info.y,
                    tab.kind === "live" ? liveTabMenu() : tabActions(tab)
                );
                return;
            }
            if (info.button !== 0) return;
            if (isLive) {
                if (info.isDoubleClickSecond) return;
                selectLiveTab();
                return;
            }
            if (tab.confirmed) beginTabDrag(tab.path, tab.importJsonPath, info.x, info.y);
            if (info.isDoubleClickSecond) confirmSelect(tab.path, tab.importJsonPath);
            else setActiveTab(tab.path, tab.importJsonPath);
        },
        onHover: isDraggable
            ? (rect, mouseX, mouseY) =>
                  updateTabDrag(tab.path, tab.importJsonPath, rect, mouseX, mouseY)
            : undefined,
        children: [
            Container({
                style: {
                    direction: "row",
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                    align: "center",
                    padding: [
                        { side: "x", value: TAB_LABEL_PAD_X },
                        { side: "top", value: 1 },
                    ],
                },
                children: [
                    isDraggable &&
                        Icon({
                            name: Icons.gripVertical,
                            color: COLOR_TEXT_DIM,
                            style: {
                                width: { kind: "px", value: TAB_HANDLE_W },
                                height: { kind: "px", value: 10 },
                            },
                        }),
                    isDraggable &&
                        Container({
                            style: {
                                width: { kind: "px", value: TAB_HANDLE_GAP },
                                height: { kind: "grow" },
                            },
                            children: [],
                        }),
                    isLive &&
                        Icon({
                            name:
                                getSessionVerb() === "import"
                                    ? Icons.upload
                                    : Icons.download,
                            style: {
                                width: { kind: "px", value: TAB_ICON_W },
                                height: { kind: "px", value: 10 },
                            },
                        }),
                    isLive &&
                        Container({
                            style: {
                                width: { kind: "px", value: TAB_ICON_GAP },
                                height: { kind: "grow" },
                            },
                            children: [],
                        }),
                    hasDot &&
                        Text({
                            text: GLYPH_DOT,
                            color: STATUS_COLOR[fileStatus],
                            tooltip: STATUS_LABEL[fileStatus],
                            tooltipColor: STATUS_COLOR[fileStatus],
                            style: { width: { kind: "px", value: TAB_DOT_W } },
                        }),
                    isQueued &&
                        Icon({
                            name: Icons.listCheck,
                            color: ACCENT_TEAL,
                            tooltip:
                                queuedCount === 1 ? "Queued" : `${queuedCount} queued`,
                            tooltipColor: ACCENT_TEAL,
                            style: {
                                width: { kind: "px", value: TAB_ICON_W },
                                height: { kind: "px", value: 10 },
                            },
                        }),
                    isQueued &&
                        Container({
                            style: {
                                width: { kind: "px", value: TAB_ICON_GAP },
                                height: { kind: "grow" },
                            },
                            children: [],
                        }),
                    Text({ text: labelText }),
                ],
            }),
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
                    if (isLive) closeLiveTab();
                    else closeTab(tab.path, tab.importJsonPath);
                },
                children: [
                    Icon({
                        name: Icons.x,
                        style: {
                            width: { kind: "px", value: 9 },
                            height: { kind: "px", value: 9 },
                        },
                    }),
                ],
            }),
        ],
    });
}

function emptyTabPlaceholder(): Element {
    const labelText = "No file";
    const tabW = Renderer.getStringWidth(labelText) + TAB_LABEL_PAD_X * 2 + TAB_W_BUFFER;
    return Container({
        style: {
            direction: "row",
            align: "center",
            width: { kind: "px", value: tabW },
            height: { kind: "grow" },
            background: TAB_BG,
            padding: [
                { side: "x", value: TAB_LABEL_PAD_X },
                { side: "top", value: 1 },
            ],
        },
        children: [
            Text({
                text: labelText,
                color: TAB_EMPTY_TEXT,
            }),
        ],
    });
}

function tabStripChildren(): Element[] {
    const tabs = getTabs();
    if (tabs.length === 0) return [emptyTabPlaceholder()];
    return tabs.map(tabButton);
}

function displayPath(p: string): string {
    const compact = compactPath(p);
    const marker = "/projects/";
    if (compact.substring(0, marker.length) === marker) {
        return compact.substring(marker.length);
    }
    return compact;
}

function displayedActivePath(p: string): string {
    if (isLiveTabActive() && getSessionVerb() !== "import") {
        const marker = p.lastIndexOf(".live-");
        if (marker >= 0) {
            const base = displayPath(p.substring(0, marker));
            const listLabel = getActiveTaskListLabel();
            return listLabel === null ? base : `${base} · ${listLabel}`;
        }
    }
    return displayPath(p);
}

function pathLabel(): Element {
    return Text({
        text: () => {
            const p = getActivePath();
            return p === null ? "" : displayedActivePath(p);
        },
        color: 0xff888888 | 0,
        truncate: true,
        style: { width: { kind: "grow" } },
    });
}

function isSnbtPath(p: string): boolean {
    return hasExt(p, "snbt");
}

function formatActiveSnbt(): void {
    const path = getActivePath();
    if (path === null) return;
    let src: string;
    try {
        src = fileLoader.readFile(path);
    } catch (err) {
        ChatLib.chat(`&c[htsw] format: read failed: ${String(err)}`);
        return;
    }
    const sm = new htsw.SourceMap(new StringFileLoader(src));
    const gcx = new htsw.GlobalCtxt(sm, "format.snbt");
    const tag = htsw.nbt.parseSnbt(gcx, "format.snbt");
    if (tag === undefined || gcx.isFailed()) {
        let msg = "parse failed";
        for (let i = 0; i < gcx.diagnostics.length; i++) {
            const d = gcx.diagnostics[i];
            if (d.level === "error" || d.level === "bug") {
                msg = d.message;
                break;
            }
        }
        ChatLib.chat(`&c[htsw] format: ${msg}`);
        return;
    }
    const formatted = htsw.nbt.printSnbt(tag, { pretty: true, indent: "    " });
    try {
        FileLib.write(path, formatted, true);
    } catch (err) {
        ChatLib.chat(`&c[htsw] format: write failed: ${String(err)}`);
        return;
    }
    fileCache.delete(path);
    ChatLib.chat(`&a[htsw] formatted ${path}`);
}

function viewTabHeader(): Element {
    return Row({
        style: { gap: 4, align: "center", height: { kind: "px", value: SIZE_ROW_H } },
        children: () => {
            const p = getActivePath();
            const children: Element[] = [pathLabel()];
            if (isLiveTabActive()) children.push(ImportCodeViewFollowButton());
            if (!isLiveTabActive() && p !== null && isSnbtPath(p)) {
                children.push(
                    Button({
                        text: "Format",
                        style: {
                            width: { kind: "px", value: 50 },
                            height: { kind: "grow" },
                            background: COLOR_BUTTON,
                            hoverBackground: COLOR_BUTTON_HOVER,
                        },
                        onClick: () => formatActiveSnbt(),
                    })
                );
            }
            return children;
        },
    });
}

function viewTab(): Element {
    return Col({
        style: { gap: 4, width: { kind: "grow" }, height: { kind: "grow" } },
        children: [
            Container({
                style: {
                    direction: "col",
                    gap: 4,
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                },
                children: [
                    Scroll({
                        id: TAB_STRIP_SCROLL_ID,
                        axis: "x",
                        style: {
                            gap: 2,
                            height: { kind: "px", value: TAB_H },
                            background: TAB_STRIP_BG,
                        },
                        children: tabStripChildren,
                    }),
                    viewTabHeader(),
                    viewBody(),
                ],
            }),
            Container({
                anchorKey: "tour:right-import",
                style: { width: { kind: "grow" } },
                children: [viewFooter()],
            }),
        ],
    });
}

export function RightPanel(): Element {
    return Col({
        style: { padding: 6, gap: 4, width: { kind: "grow" }, height: { kind: "grow" } },
        children: [viewTab()],
    });
}
