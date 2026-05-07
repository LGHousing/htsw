/// <reference types="../../../CTAutocomplete" />

import { Child, ClickInfo, Element, Rect } from "../lib/layout";
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
import { SyntaxToken, tokenizeHtsl } from "./syntax";
import { FileSystemFileLoader } from "../../utils/files";
import { actionsToLines, parseHtslFile, type HtslLine } from "../state/htsl-render";
import {
    COLOR_BY_STATE,
    ROW_BG_BY_STATE,
    diffKey,
    getDiffEntry,
    type DiffState,
    type DiffLineInfo,
} from "../state/diff";
import {
    getCheckedImportableCount,
    getCurrentImportingPath,
    getHousingUuid,
    getImportEtaSeconds,
    getImportStartedAt,
    getImportJsonPath,
    getImportProgress,
    getImportProgressFraction,
    getParsedResult,
    isCurrentHouseTrusted,
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
import { openFileBrowser } from "../popovers/file-browser";
import { composeFileMenu } from "../state/fileMenu";
import {
    CAPTURE_TYPES,
    queueItemsForCheckedKeys,
    startCaptureExport,
    startImport,
} from "./import-actions";
import { clearImportableChecks, getCheckedImportableKeys } from "../state";


const TAB_BG = 0xff2c323b | 0;
const TAB_BG_HOVER = 0xff3a4350 | 0;
const TAB_BG_ACTIVE = 0xff4a5566 | 0;
const TAB_BG_ACTIVE_HOVER = 0xff586477 | 0;
const COLOR_GUTTER = 0xff666666 | 0;
const COLOR_PLAIN = 0xffe5e5e5 | 0;
const COLOR_ERROR = 0xffe85c5c | 0;
const LINE_H = 10;
const DIAG_ERROR_BG = 0x40e85c5c | 0;
const DIAG_WARN_BG = 0x40e5bc4b | 0;

type DiagLevel = "error" | "warning";

function diagLinesForActive(active: string): Map<number, DiagLevel> {
    const out = new Map<number, DiagLevel>();
    const parsed = getParsedResult();
    if (parsed === null) return out;
    const sm = parsed.gcx.sourceMap;
    const norm = active.replace(/\\/g, "/");
    for (let i = 0; i < parsed.diagnostics.length; i++) {
        const d = parsed.diagnostics[i];
        const level: DiagLevel | null =
            d.level === "error" || d.level === "bug"
                ? "error"
                : d.level === "warning"
                  ? "warning"
                  : null;
        if (level === null) continue;
        for (let j = 0; j < d.spans.length; j++) {
            const span = d.spans[j].span;
            let file;
            try {
                file = sm.getFileByPos(span.start);
            } catch (_e) {
                continue;
            }
            if (file.path.replace(/\\/g, "/") !== norm) continue;
            const startLine = file.getPosition(span.start).line;
            const endLine = file.getPosition(span.end).line;
            for (let ln = startLine; ln <= endLine; ln++) {
                const prev = out.get(ln);
                if (level === "error" || prev !== "error") out.set(ln, level);
            }
        }
    }
    return out;
}

function bgForDiag(level: DiagLevel | undefined): number | undefined {
    if (level === "error") return DIAG_ERROR_BG;
    if (level === "warning") return DIAG_WARN_BG;
    return undefined;
}

const fileLoader = new FileSystemFileLoader();
type CachedFile = { mtime: number; lines: string[] };
const fileCache = new Map<string, CachedFile>();

function endsWith(s: string, suffix: string): boolean {
    return s.length >= suffix.length && s.lastIndexOf(suffix) === s.length - suffix.length;
}

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

function getMtimeMs(path: string): number {
    try {
        // @ts-ignore
        const Paths = Java.type("java.nio.file.Paths");
        // @ts-ignore
        const Files = Java.type("java.nio.file.Files");
        return Number(Files.getLastModifiedTime(Paths.get(String(path))).toMillis());
    } catch (_e) {
        return 0;
    }
}

function readPlainLines(path: string): string[] {
    const mtime = getMtimeMs(path);
    const cached = fileCache.get(path);
    if (cached !== undefined && cached.mtime === mtime) return cached.lines;
    let lines: string[] = [];
    try {
        const src = fileLoader.readFile(path);
        lines = src.split("\n");
    } catch (e) {
        lines = [`// failed to read ${path}: ${e}`];
    }
    fileCache.set(path, { mtime, lines });
    return lines;
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

// Per-state gutter glyph. Makes diff state legible at a glance even when
// the foreground-color shifts are subtle (e.g. unknown-gray vs match-white
// on similar backgrounds). Plain ASCII so the MC default font renders all.
const STATE_GLYPH: { [k in DiffState]: string } = {
    unknown: " ",
    match: "✓",
    edit: "~",
    delete: "-",
    add: "+",
    current: ">",
};

function tokenTexts(tokens: SyntaxToken[]): Element[] {
    const out: Element[] = [];
    for (let i = 0; i < tokens.length; i++) {
        out.push(Text({ text: tokens[i].text, color: tokens[i].color }));
    }
    return out;
}

function digitsOf(n: number): number {
    if (n <= 0) return 1;
    let d = 0;
    let x = n;
    while (x > 0) {
        d++;
        x = Math.floor(x / 10);
    }
    return d;
}

function padLeft(s: string, width: number): string {
    let out = s;
    while (out.length < width) out = " " + out;
    return out;
}

function lineRow(
    lineNum: number,
    padWidth: number,
    tokens: SyntaxToken[],
    glyphColor: number,
    bg: number | undefined,
    state: DiffState,
    detail?: string
): Element {
    const children: Element[] = [
        Text({
            text: STATE_GLYPH[state],
            color: glyphColor,
            style: { width: { kind: "px", value: 8 } },
        }),
        Text({
            text: padLeft(String(lineNum), padWidth),
            color: COLOR_GUTTER,
            style: { width: { kind: "px", value: 24 } },
        }),
        Container({
            style: {
                direction: "row",
                width: { kind: "grow" },
                height: { kind: "grow" },
                align: "center",
                gap: 0,
            },
            children: tokenTexts(tokens),
        }),
    ];
    if (detail !== undefined && detail.length > 0) {
        children.push(
            Text({
                text: shortenForDisplay(detail, 42),
                color: glyphColor,
                style: { width: { kind: "px", value: 180 } },
            })
        );
    }
    return Container({
        style: {
            direction: "row",
            padding: { side: "x", value: 4 },
            gap: 4,
            height: { kind: "px", value: LINE_H },
            background: bg,
        },
        children,
    });
}

/** One-color line for parse errors / labels / comments — bypasses tokenizer. */
function plainTokens(text: string, color: number): SyntaxToken[] {
    return [{ text, color }];
}

function indentedText(line: HtslLine): string {
    let prefix = "";
    for (let i = 0; i < line.depth; i++) prefix += "  ";
    return prefix + line.text;
}

function summaryText(entry: NonNullable<ReturnType<typeof getDiffEntry>>): string {
    const s = entry.summary;
    if (s === null) return "";
    return `${s.edits} edits · ${s.adds} adds · ${s.deletes} deletes · ${s.moves} moves`;
}

function diffLineDetail(
    state: DiffState,
    info: DiffLineInfo | undefined
): string | undefined {
    if (info === undefined) return undefined;
    if (state === "current" && info.label) return `current: ${info.label}`;
    if (info.completed === true) return undefined;
    if (info.kind === "edit") return info.detail ? `edit: ${info.detail}` : undefined;
    if (info.kind === "add") return "add";
    if (info.kind === "move") return info.detail ? `move: ${info.detail}` : "move";
    if (info.kind === "delete") return "delete";
    return info.detail;
}

export type HtslDiffLinesOptions = {
    focusCurrent?: boolean;
    before?: number;
    after?: number;
};

export function htslDiffLines(path: string, options?: HtslDiffLinesOptions): Element[] {
    const parsed = parseHtslFile(path);
    if (parsed.parseError !== null) {
        const errLines = parsed.parseError.split("\n");
        const out: Element[] = [
            lineRow(0, 1, plainTokens("// parse failed", COLOR_ERROR), COLOR_ERROR, undefined, "unknown"),
        ];
        for (let i = 0; i < errLines.length; i++) {
            out.push(
                lineRow(
                    0,
                    1,
                    plainTokens(shortenForDisplay(errLines[i], 60), COLOR_ERROR),
                    COLOR_ERROR,
                    undefined,
                    "unknown"
                )
            );
        }
        return out;
    }
    const lines = actionsToLines(parsed.actions);
    if (lines.length === 0) {
        return [
            lineRow(
                1,
                1,
                plainTokens("// (empty function)", COLOR_GUTTER),
                COLOR_GUTTER,
                undefined,
                "unknown"
            ),
        ];
    }
    const entry = getDiffEntry(diffKey(path));
    const hasLabel = entry !== undefined && entry.currentLabel.length > 0;
    const hasSummary = entry !== undefined && entry.summary !== null;
    const padWidth = digitsOf(lines.length + (hasLabel || hasSummary ? 1 : 0));
    const out: Element[] = [];
    if (entry !== undefined && entry.phaseLabel.length > 0) {
        out.push(
            lineRow(
                0,
                padWidth,
                plainTokens(`// ${entry.phaseLabel}`, COLOR_GUTTER),
                COLOR_GUTTER,
                undefined,
                "unknown"
            )
        );
    }
    if (hasSummary && entry !== undefined) {
        out.push(
            lineRow(
                0,
                padWidth,
                plainTokens(`// ${summaryText(entry)}`, COLOR_GUTTER),
                COLOR_GUTTER,
                undefined,
                "unknown"
            )
        );
    }
    let first = 0;
    let last = lines.length - 1;
    if (options?.focusCurrent === true && entry?.currentPath !== null && entry !== undefined) {
        let currentLine = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].actionPath === entry.currentPath) {
                currentLine = i;
                break;
            }
        }
        if (currentLine >= 0) {
            first = Math.max(0, currentLine - (options.before ?? 1));
            last = Math.min(lines.length - 1, currentLine + (options.after ?? 2));
        }
    }
    for (let i = first; i <= last; i++) {
        const ln = lines[i];
        const state: DiffState = entry?.states.get(ln.actionPath) ?? "unknown";
        const isCurrent = entry?.currentPath === ln.actionPath;
        const effectiveState: DiffState = isCurrent ? "current" : state;
        const info = entry?.details.get(ln.actionPath);
        const stateColor = COLOR_BY_STATE[effectiveState];
        const bg = ROW_BG_BY_STATE[effectiveState];
        const lineText = shortenForDisplay(indentedText(ln), 80);
        // For the live-cursor line, paint the whole line in the cursor colour
        // so it reads as one focused unit. All other states keep syntax
        // colouring — the row background already conveys the diff state.
        const tokens = effectiveState === "current"
            ? plainTokens(lineText, stateColor)
            : tokenizeHtsl(lineText);
        out.push(
            lineRow(
                i + 1,
                padWidth,
                tokens,
                stateColor,
                bg,
                effectiveState,
                diffLineDetail(effectiveState, info)
            )
        );
    }
    if (hasLabel) {
        const labelColor = 0xff67a7e8 | 0;
        out.push(
            lineRow(
                lines.length + 1,
                padWidth,
                plainTokens(`// ${entry.currentLabel}`, labelColor),
                labelColor,
                undefined,
                "current"
            )
        );
    }
    if (entry !== undefined && entry.deletes.length > 0) {
        out.push(
            lineRow(
                0,
                padWidth,
                plainTokens("// Housing-only actions to delete", COLOR_ERROR),
                COLOR_ERROR,
                undefined,
                "delete"
            )
        );
        for (let i = 0; i < entry.deletes.length; i++) {
            const d = entry.deletes[i];
            out.push(
                lineRow(
                    d.index + 1,
                    padWidth,
                    plainTokens(`- ${d.label}`, COLOR_ERROR),
                    COLOR_ERROR,
                    ROW_BG_BY_STATE.delete,
                    "delete",
                    d.detail
                )
            );
        }
    }
    return out;
}

function plainTextLines(path: string): Element[] {
    const lines = readPlainLines(path);
    const diags = diagLinesForActive(path);
    const padWidth = digitsOf(lines.length);
    const out: Element[] = [];
    for (let i = 0; i < lines.length; i++) {
        const ln = i + 1;
        const bg = bgForDiag(diags.get(ln));
        out.push(
            lineRow(
                ln,
                padWidth,
                plainTokens(shortenForDisplay(lines[i], 80), COLOR_PLAIN),
                COLOR_PLAIN,
                bg,
                "unknown"
            )
        );
    }
    return out;
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

function sourceBody(): Element {
    return Scroll({
        id: "right-source-scroll",
        style: { height: { kind: "grow" }, gap: 0 },
        children: () => {
            const active = getActivePath();
            if (active === null) {
                return [
                    Text({
                        text: "Click an entry on the left to preview, double-click to pin a tab.",
                        color: 0xff888888 | 0,
                        style: { padding: 6 },
                    }),
                ];
            }
            const norm = active.replace(/\\/g, "/").toLowerCase();
            const out: Child[] =
                endsWith(norm, ".htsl") ? htslDiffLines(active) : plainTextLines(active);
            return out;
        },
    });
}

/**
 * Render a path as `./htsw/...` when the path passes through the htsw repo,
 * else as `./...` relative to the MC root. No length-based truncation — the
 * scissor on the path-label container clips any overflow at the panel edge.
 */
function displayPath(p: string): string {
    return normalizeHtswPath(p);
}

let cachedMcRootForwardSlash: string | null = null;
function mcRootForward(): string {
    if (cachedMcRootForwardSlash !== null) return cachedMcRootForwardSlash;
    try {
        // @ts-ignore
        const Paths = Java.type("java.nio.file.Paths");
        cachedMcRootForwardSlash = String(
            Paths.get(".").toAbsolutePath().normalize().toString()
        ).replace(/\\/g, "/");
    } catch (_e) {
        cachedMcRootForwardSlash = "";
    }
    return cachedMcRootForwardSlash;
}

/**
 * Strip MC-root absolute path prefixes from arbitrary text (e.g. parser
 * diagnostic messages that embed file paths) and replace each with `./`.
 * Then hard-truncate to `maxLen` chars so a long error message can't
 * smear across the right-pane edge.
 */
function shortenForDisplay(text: string, maxLen: number): string {
    let s = text;
    const root = mcRootForward();
    if (root.length > 0) {
        // Match both forward- and back-slash forms of the root prefix.
        const rootBack = root.replace(/\//g, "\\\\");
        s = s.split(`${root}/`).join("./");
        s = s.split(`${root}\\`).join("./");
        s = s.split(rootBack).join("./");
    }
    if (s.length > maxLen) {
        return `${s.substring(0, maxLen - 1)}…`;
    }
    return s;
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
            sourceBody(),
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

function queueHeader(): Element {
    return Row({
        style: { gap: 4, height: { kind: "px", value: 16 }, align: "center" },
        children: [
            Text({
                text: () => {
                    const n = getQueueLength();
                    return n === 0 ? "Queue (empty)" : `Queue (${n})`;
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

function captureMenuPopoverContent(): Element {
    return Col({
        style: { gap: 2, padding: 4 },
        children: [
            Row({
                style: { gap: 4, height: { kind: "px", value: SIZE_ROW_H } },
                children: [
                    Text({
                        text: () => shortPath(getImportJsonPath()),
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
                        onClick: () => {
                            closeAllPopovers();
                            openFileBrowser(dirOfPath(getImportJsonPath()) || ".");
                        },
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
    return Col({
        style: { gap: 4, width: { kind: "grow" }, height: { kind: "grow" } },
        children: [
            houseHeader(),
            queueHeader(),
            Scroll({
                id: "right-import-queue-scroll",
                style: { gap: 2, height: { kind: "grow" } },
                children: () => {
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
            }),
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
