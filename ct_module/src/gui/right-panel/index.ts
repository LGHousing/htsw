/// <reference types="../../../CTAutocomplete" />

import { ClickInfo, Element, Rect } from "../lib/layout";
import { Button, Col, Container, Icon, Row, Text } from "../lib/components";
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
} from "./selection";
import { openMenu, MenuAction } from "../lib/menu";
import {
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_TAB,
    COLOR_TAB_ACCENT,
    COLOR_TAB_ACTIVE,
    COLOR_TAB_ACTIVE_HOVER,
    COLOR_TAB_HOVER,
    GLYPH_DOT,
    SIZE_ROW_H,
    SIZE_TAB_H,
} from "../lib/theme";
import { statusForFile, STATUS_COLOR, STATUS_LABEL } from "../cache-status";
import { FileSystemFileLoader, StringFileLoader } from "../../utils/fileLoaders";
import * as htsw from "htsw";
import { viewBody } from "./view-body";
import { normalizeHtswPath } from "../lib/pathDisplay";
import { composeFileMenu } from "../menus/fileMenu";
import { importTab } from "./import-tab";


const TAB_BG = 0xff2c323b | 0;
const TAB_BG_HOVER = 0xff3a4350 | 0;
const TAB_BG_ACTIVE = 0xff4a5566 | 0;
const TAB_BG_ACTIVE_HOVER = 0xff586477 | 0;



const fileLoader = new FileSystemFileLoader();
type CachedFile = { mtime: number; lines: string[] };
const fileCache = new Map<string, CachedFile>();

function endsWith(s: string, suffix: string): boolean {
    return s.length >= suffix.length && s.lastIndexOf(suffix) === s.length - suffix.length;
}

function stem(p: string): string {
    // Split on both separators: tab paths can be absolute Windows paths with
    // backslashes. Splitting on `/` alone would leave the whole `C:\…` path as
    // the "basename", so the tab button would show the full path instead of
    // just the file stem.
    const fwd = p.lastIndexOf("/");
    const back = p.lastIndexOf("\\");
    const slash = fwd > back ? fwd : back;
    const base = slash < 0 ? p : p.substring(slash + 1);
    const dot = base.lastIndexOf(".");
    return dot <= 0 ? base : base.substring(0, dot);
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

const TAB_DOT_W = 8;

function tabButton(tab: Tab): Element {
    const isActive = getActivePath() === tab.path;
    const labelText = tab.confirmed ? stem(tab.path) : `§o${stem(tab.path)}`;
    const tabBg = isActive ? TAB_BG_ACTIVE : TAB_BG;
    const tabHoverBg = isActive ? TAB_BG_ACTIVE_HOVER : TAB_BG_HOVER;
    const fileStatus = statusForFile(tab.path);
    const hasDot = fileStatus !== null;
    const labelW = Renderer.getStringWidth(labelText);
    const tabW = (hasDot ? TAB_DOT_W : 0) + labelW + TAB_LABEL_PAD_X * 2 + TAB_CLOSE_W + TAB_W_BUFFER;
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
                children: [
                    hasDot && Text({
                        text: GLYPH_DOT,
                        color: STATUS_COLOR[fileStatus],
                        tooltip: STATUS_LABEL[fileStatus],
                        tooltipColor: STATUS_COLOR[fileStatus],
                        style: { width: { kind: "px", value: TAB_DOT_W } },
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
                    closeTab(tab.path);
                },
                children: [Icon({ name: Icons.x })],
            }),
        ],
    });
}
















function sourceBody(): Element {
    return viewBody();
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

function isSnbtPath(p: string): boolean {
    return endsWith(p.replace(/\\/g, "/").toLowerCase(), ".snbt");
}

/**
 * Parse the active .snbt file and rewrite it with the language printer's
 * pretty mode, then drop the plain-text view cache so the next render
 * picks up the new bytes. Surfaces any parser diagnostic in chat rather
 * than silently failing — formatting a malformed SNBT is a no-op.
 */
function formatActiveSnbt(): void {
    const path = getActivePath();
    if (path === null) return;
    let src: string;
    try {
        src = fileLoader.readFile(path);
    } catch (err) {
        ChatLib.chat(`&c[htsw] format: read failed: ${err}`);
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
        FileLib.write(String(path), formatted, true);
    } catch (err) {
        ChatLib.chat(`&c[htsw] format: write failed: ${err}`);
        return;
    }
    fileCache.delete(path);
    ChatLib.chat(`&a[htsw] formatted ${path}`);
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

function viewTabHeader(): Element {
    return Row({
        style: { gap: 4, align: "center", height: { kind: "px", value: SIZE_ROW_H } },
        children: () => {
            const p = getActivePath();
            const children: Element[] = [pathLabel()];
            if (p !== null && isSnbtPath(p)) {
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
            Row({
                style: { gap: 2, height: { kind: "px", value: TAB_H } },
                children: () => getTabs().map(tabButton),
            }),
            viewTabHeader(),
            sourceBody(),
        ],
    });
}

// ── Import tab (queue + live importer + capture/import buttons) ─────────





























export function RightPanel(): Element {
    return Col({
        style: { padding: 6, gap: 4, width: { kind: "grow" }, height: { kind: "grow" } },
        children: () => [
            panelTabBar(),
            getActiveRightTab() === "view" ? viewTab() : importTab(),
        ],
    });
}
