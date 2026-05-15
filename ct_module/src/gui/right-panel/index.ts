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
import { javaType } from "../lib/java";
import {
    ACCENT_DANGER,
    ACCENT_SUCCESS,
    COLOR_BUTTON,
    COLOR_BUTTON_HOVER,
    COLOR_BUTTON_DANGER,
    COLOR_BUTTON_DANGER_HOVER,
    COLOR_BUTTON_PRIMARY,
    COLOR_BUTTON_PRIMARY_HOVER,
    COLOR_PANEL,
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
    PHASE_APPLYING,
    PHASE_HYDRATING,
    PHASE_READING,
    SIZE_ROW_H,
    SIZE_TAB_H,
} from "../lib/theme";
import { SyntaxToken, tokenizeHtsl } from "./syntax";
import { FileSystemFileLoader, StringFileLoader } from "../../utils/files";
import * as htsw from "htsw";
import type { Importable } from "htsw/types";
import { actionsToLines, parseHtslFile, type HtslLine } from "../state/htsl-render";
import {
    COLOR_BY_STATE,
    ROW_BG_BY_STATE,
    diffKey,
    getDiffEntry,
    type DiffState,
    type DiffLineInfo,
} from "../state/diff";
import { cacheFileMtimeFor, computeCacheDiff } from "../state/cacheDiff";
import { canonicalPath, parseImportJsonAt } from "../state/parses";
import {
    getCheckedImportableCount,
    getCurrentImportingPath,
    getCurrentPhaseEtaSeconds,
    getHousingUuid,
    getImportEtaSeconds,
    getImportStartedAt,
    getImportJsonPath,
    getImportProgress,
    getImportProgressFraction,
    getParsedResult,
    getQueueItemRunState,
    isCurrentHouseTrusted,
    isCurrentQueueItem,
    isImportSoundsMuted,
    setHouseTrust,
    setImportSoundsMuted,
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
import { importableIdentity } from "../../knowledge/paths";
import { orderImportablesForImportSession } from "../../importables/importSession";


const TAB_BG = 0xff2c323b | 0;
const TAB_BG_HOVER = 0xff3a4350 | 0;
const TAB_BG_ACTIVE = 0xff4a5566 | 0;
const TAB_BG_ACTIVE_HOVER = 0xff586477 | 0;
const COLOR_GUTTER = 0xff666666 | 0;
const COLOR_PLAIN = 0xffe5e5e5 | 0;
const COLOR_ERROR = 0xffe85c5c | 0;
const collapsedQueueImportJsonRows: Set<string> = new Set();
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
        const Paths = javaType("java.nio.file.Paths");
        const Files = javaType("java.nio.file.Files");
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
        // CRLF-saved files (common on Windows or after a manual VSCode save)
        // would otherwise show a `[CR]` glyph at every line end in MC's font.
        for (let i = 0; i < lines.length; i++) {
            const ln = lines[i];
            if (ln.length > 0 && ln.charCodeAt(ln.length - 1) === 13) {
                lines[i] = ln.substring(0, ln.length - 1);
            }
        }
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
    // Match is the default — leaving the gutter clean here means a page
    // full of matches reads as quietly as a plain text view, with markers
    // only on the lines that actually need attention.
    match: " ",
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
    // Cells sized to actual content. Glyph is one ASCII char (6px slot fits
    // every glyph in STATE_GLYPH). Line numbers are padded to padWidth, so
    // padWidth * 6 fits any value at this depth in MC's default font where
    // each digit is 6px wide. Pre-tightening these saves ~14px of left
    // margin vs the previous fixed 8/24 cells — that gap was the bulk of
    // the wasted space between the gutter and the code.
    const LINE_NUM_DIGIT_W = 6;
    const children: Element[] = [
        Text({
            text: STATE_GLYPH[state],
            color: glyphColor,
            style: { width: { kind: "px", value: 6 } },
        }),
        Text({
            text: padLeft(String(lineNum), padWidth),
            color: COLOR_GUTTER,
            style: { width: { kind: "px", value: padWidth * LINE_NUM_DIGIT_W } },
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

// `htslDiffLines` is called once per frame from the right-panel Scroll
// children-extractor. For a long file this used to redo: actionsToLines
// (calls `printAction` per action), tokenizeHtsl per line, actionHash per
// action (via computeCacheDiff), and a fresh Element allocation per line.
// Pure scrolling doesn't change any of that — so memoize on the inputs
// that actually invalidate the rendered tree:
//   - parsed source identity (re-parse on file mtime change)
//   - the diff key inputs (live importer state during an active run,
//     cache file mtime otherwise)
//   - the focus-window options
// Hit rate while idle is effectively 100%; the cost reduces to a
// dictionary lookup + a single filesystem stat for the cache mtime.
type DiffLinesCacheEntry = {
    parsedRef: object;
    liveActive: boolean;
    liveUpdatedAt: number;
    cacheMtime: number;
    optionsKey: string;
    result: Element[];
};
const diffLinesCache = new Map<string, DiffLinesCacheEntry>();

function optionsKeyOf(options: HtslDiffLinesOptions | undefined): string {
    if (options === undefined) return "";
    const f = options.focusCurrent === true ? "1" : "0";
    return `${f}|${options.before ?? ""}|${options.after ?? ""}`;
}

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
    // Live importer entry only counts when this file is the one being
    // worked on right now — otherwise an old session's stale states would
    // outrank fresh cache-diff. The cache-diff map is the idle/baseline
    // source of states: source-vs-knowledge per action.
    const live = getDiffEntry(diffKey(path));
    const importing = getCurrentImportingPath();
    const liveActive =
        live !== undefined &&
        importing !== null &&
        canonicalPath(importing) === canonicalPath(path);
    const liveUpdatedAt = live !== undefined ? live.updatedAt : 0;
    const cacheMtime = liveActive ? 0 : cacheFileMtimeFor(path);
    const optionsKey = optionsKeyOf(options);
    const cached = diffLinesCache.get(path);
    if (
        cached !== undefined &&
        cached.parsedRef === parsed &&
        cached.liveActive === liveActive &&
        cached.liveUpdatedAt === liveUpdatedAt &&
        cached.cacheMtime === cacheMtime &&
        cached.optionsKey === optionsKey
    ) {
        return cached.result;
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
    const entry = liveActive ? live : undefined;
    const cacheStates = liveActive ? null : computeCacheDiff(path, parsed.actions);
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
        const state: DiffState =
            entry?.states.get(ln.actionPath) ??
            cacheStates?.get(ln.actionPath) ??
            "unknown";
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
    diffLinesCache.set(path, {
        parsedRef: parsed,
        liveActive,
        liveUpdatedAt,
        cacheMtime,
        optionsKey,
        result: out,
    });
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
    if (total < 60) return `${total}s`;
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m < 60) return s === 0 ? `${m}m` : `${m}m${s}s`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm === 0 ? `${h}h` : `${h}h${mm}m`;
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
    if (secs === null) return p === null ? "" : "total ETA calculating…";
    return formatEtaSeconds(secs);
}

function progressEtaIsStable(): boolean {
    const p = getImportProgress();
    if (p === null) return false;
    return p.etaConfidence === "planned" || p.phase === "applying" || p.phase === "done";
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
        const Paths = javaType("java.nio.file.Paths");
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

function shortSource(p: string): string {
    const norm = p.replace(/\\/g, "/");
    const slash = norm.lastIndexOf("/");
    return slash < 0 ? norm : norm.substring(slash + 1);
}

function phaseSegment(weight: number, fraction: number, color: number): Element {
    return Container({
        style: {
            direction: "row",
            width: { kind: "grow", factor: Math.max(0.0001, weight) },
            height: { kind: "grow" },
        },
        children: [
            Container({
                style: {
                    width: { kind: "grow", factor: Math.max(0.0001, fraction) },
                    height: { kind: "grow" },
                    background: color,
                },
                children: [],
            }),
            Container({
                style: {
                    width: { kind: "grow", factor: Math.max(0.0001, 1 - fraction) },
                    height: { kind: "grow" },
                },
                children: [],
            }),
        ],
    });
}

function queueRowMiniBar(item: QueueItem): Element {
    const state = getQueueItemRunState(item);
    if (state.kind === "queued") {
        // Empty 2px slot — keeps row heights uniform.
        return Container({
            style: { width: { kind: "grow" }, height: { kind: "px", value: 2 } },
            children: [],
        });
    }
    if (state.kind === "done") {
        return Container({
            style: {
                width: { kind: "grow" },
                height: { kind: "px", value: 2 },
                background: ACCENT_SUCCESS,
            },
            children: [],
        });
    }
    if (state.kind === "failed") {
        return Container({
            style: {
                width: { kind: "grow" },
                height: { kind: "px", value: 2 },
                background: ACCENT_DANGER,
            },
            children: [],
        });
    }
    // current — three phase segments side-by-side, each filled per its
    // own fraction. Widths are proportional to phase budget so a hydrate-
    // heavy importable shows a wider purple region.
    return Container({
        style: {
            direction: "row",
            width: { kind: "grow" },
            height: { kind: "px", value: 2 },
        },
        children: [
            phaseSegment(state.readWeight, state.readFraction, PHASE_READING),
            phaseSegment(state.hydrateWeight, state.hydrateFraction, PHASE_HYDRATING),
            phaseSegment(state.applyWeight, state.applyFraction, PHASE_APPLYING),
        ],
    });
}

function queueImportableLabel(imp: Importable): string {
    return imp.type === "EVENT" ? imp.event : imp.name;
}

function queueImportJsonChildren(item: QueueItem): QueueItem[] {
    if (item.kind !== "importJson") return [];
    const cached = parseImportJsonAt(item.sourcePath);
    if (cached.parsed === null) return [];
    const ordered = orderImportablesForImportSession(
        cached.parsed.value,
        cached.parsed.value
    );
    return ordered.map((imp) => ({
        kind: "importable",
        sourcePath: item.sourcePath,
        identity: importableIdentity(imp),
        type: imp.type,
        label: queueImportableLabel(imp),
    }));
}

function isQueueImportJsonExpanded(item: QueueItem): boolean {
    return item.kind === "importJson" && !collapsedQueueImportJsonRows.has(queueItemKey(item));
}

function queueRow(item: QueueItem): Element {
    const typeText = item.kind === "importJson" ? "ALL" : item.type;
    const isCurrent = isCurrentQueueItem(item);
    const canExpand = item.kind === "importJson";
    const expanded = canExpand && isQueueImportJsonExpanded(item);
    return Container({
        style: {
            direction: "col",
            height: { kind: "px", value: SIZE_ROW_H },
            background: isCurrent ? COLOR_ROW_HOVER : COLOR_ROW,
            hoverBackground: COLOR_ROW_HOVER,
        },
        children: [
            Container({
                style: {
                    direction: "row",
                    align: "center",
                    padding: [
                        { side: "left", value: 0 },
                        { side: "right", value: 6 },
                    ],
                    gap: 6,
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                },
                children: [
                    // Left-edge stripe — green for the importable currently
                    // being processed, otherwise an invisible 2px spacer.
                    Container({
                        style: {
                            width: { kind: "px", value: 2 },
                            height: { kind: "grow" },
                            background: isCurrent ? ACCENT_SUCCESS : undefined,
                        },
                        children: [],
                    }),
                    Container({
                        style: {
                            direction: "col",
                            align: "center",
                            justify: "center",
                            width: { kind: "px", value: 14 },
                            height: { kind: "grow" },
                            hoverBackground: canExpand ? COLOR_BUTTON_HOVER : undefined,
                        },
                        onClick: (_rect, info) => {
                            if (!canExpand || info.button !== 0) return;
                            const key = queueItemKey(item);
                            if (expanded) collapsedQueueImportJsonRows.add(key);
                            else collapsedQueueImportJsonRows.delete(key);
                        },
                        children: canExpand
                            ? [Icon({ name: expanded ? Icons.chevronDown : Icons.chevronRight })]
                            : [],
                    }),
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
            }),
            queueRowMiniBar(item),
        ],
    });
}

function queueImportJsonChildRow(parent: QueueItem, item: QueueItem): Element {
    const isCurrent = isCurrentQueueItem(item);
    return Container({
        style: {
            direction: "col",
            height: { kind: "px", value: SIZE_ROW_H },
            background: isCurrent ? COLOR_ROW_HOVER : COLOR_ROW,
            hoverBackground: COLOR_ROW_HOVER,
        },
        children: [
            Container({
                style: {
                    direction: "row",
                    align: "center",
                    padding: [
                        { side: "left", value: 0 },
                        { side: "right", value: 6 },
                    ],
                    gap: 6,
                    width: { kind: "grow" },
                    height: { kind: "grow" },
                },
                children: [
                    Container({
                        style: {
                            width: { kind: "px", value: 2 },
                            height: { kind: "grow" },
                            background: isCurrent ? ACCENT_SUCCESS : undefined,
                        },
                        children: [],
                    }),
                    Container({
                        style: { width: { kind: "px", value: 14 }, height: { kind: "grow" } },
                        children: [],
                    }),
                    Text({
                        text: item.kind === "importable" ? item.type : "ALL",
                        color: COLOR_TEXT_DIM,
                        style: { width: { kind: "px", value: 48 } },
                    }),
                    Text({
                        text: item.label,
                        style: { width: { kind: "grow" } },
                    }),
                    Text({
                        text: shortSource(parent.sourcePath),
                        color: COLOR_TEXT_FAINT,
                    }),
                    Container({
                        style: { width: { kind: "px", value: 14 }, height: { kind: "grow" } },
                        children: [],
                    }),
                ],
            }),
            queueRowMiniBar(item),
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
            // If we don't have per-importable weights (synthetic events
            // like the diff-demo), fall back to the simple single-fill
            // bar so we don't render an empty bar.
            if (p.weights.length === 0) {
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
            }
            // Per-importable segments. Each segment's width is proportional
            // to its initial weight estimate; fill is solid green for done
            // importables, partially filled for the current one, empty for
            // queued. 1px dark dividers between segments mark importable
            // boundaries so you can see roughly where each one will land.
            //
            // Refinement: when the current importable's *live* weight
            // (post-diff `phaseBudget.total`) exceeds its initial cache-
            // aware estimate, widen its segment to match. Without this,
            // the bar would jump from e.g. 20% → 90% as we finish the
            // prior importable, because cache underestimated how much
            // work the next one would take. Completed segments keep their
            // initial widths — refining them too would jiggle the layout.
            const liveWeights = p.weights.slice();
            if (p.orderIndex >= 0 && p.orderIndex < liveWeights.length) {
                liveWeights[p.orderIndex] = Math.max(
                    p.weights[p.orderIndex],
                    p.weightCurrent
                );
            }
            let totalWeight = 0;
            for (let i = 0; i < liveWeights.length; i++) totalWeight += liveWeights[i];
            if (totalWeight <= 0) totalWeight = 1;
            const out: Child[] = [];
            for (let i = 0; i < liveWeights.length; i++) {
                const w = liveWeights[i];
                const flexFactor = Math.max(0.0001, w / totalWeight);
                let fill: number;
                if (i < p.completed) {
                    fill = 1;
                } else if (i === p.orderIndex) {
                    const within =
                        p.estimatedCompleted - p.weightCompleted;
                    const denom = Math.max(0.0001, liveWeights[p.orderIndex]);
                    fill = Math.min(1, Math.max(0, within / denom));
                } else {
                    fill = 0;
                }
                out.push(
                    Container({
                        style: {
                            direction: "row",
                            width: { kind: "grow", factor: flexFactor },
                            height: { kind: "grow" },
                        },
                        children: [
                            Container({
                                style: {
                                    width: { kind: "grow", factor: Math.max(0.0001, fill) },
                                    height: { kind: "grow" },
                                    background: COLOR_BAR_FG,
                                },
                                children: [],
                            }),
                            Container({
                                style: {
                                    width: { kind: "grow", factor: Math.max(0.0001, 1 - fill) },
                                    height: { kind: "grow" },
                                },
                                children: [],
                            }),
                        ],
                    })
                );
                if (i < liveWeights.length - 1) {
                    out.push(
                        Container({
                            style: {
                                width: { kind: "px", value: 1 },
                                height: { kind: "grow" },
                                background: COLOR_PANEL,
                            },
                            children: [],
                        })
                    );
                }
            }
            return out;
        },
    });
}

function capitalizePhase(phase: string): string {
    if (phase.length === 0) return phase;
    return phase.charAt(0).toUpperCase() + phase.slice(1);
}

function currentPhaseEtaText(): string {
    const p = getImportProgress();
    if (p === null) return "";
    const secs = getCurrentPhaseEtaSeconds();
    if (secs === null || secs <= 0) return "";
    if (p.phase === "reading") return `${formatEtaSeconds(secs)} left reading`;
    if (p.phase === "hydrating") return `${formatEtaSeconds(secs)} left hydrating`;
    if (p.phase === "applying") return `${formatEtaSeconds(secs)} left applying`;
    return "";
}

function formatClockTime(d: Date): string {
    // Local-time HH:MM with AM/PM. Uses MC's ambient locale via the JS
    // Date methods so Java client-locale isn't needed.
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    const mm = m < 10 ? `0${m}` : String(m);
    return `${h}:${mm} ${ampm}`;
}

function progressFinishTimeText(): string {
    const secs = getImportEtaSeconds();
    if (secs === null) return "";
    const finish = new Date(Date.now() + secs * 1000);
    return `done ${formatClockTime(finish)}`;
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
                        // WHO — which importable (1-of-N) we're working on.
                        Text({
                            text: () =>
                                `Importable ${p.completed + 1} of ${p.total} · ${p.currentIdentity}`,
                            color: COLOR_TEXT,
                        }),
                        // WHAT — capitalized phase + the specific action label,
                        // bold via §l so it's the most visible line.
                        Text({
                            text: () =>
                                `§l${capitalizePhase(p.phase)}: ${progressCurrentLabel()}`,
                            color: COLOR_TEXT,
                        }),
                        // HOW FAR (in this importable) — step counter +
                        // per-importable ETA. Only the importable-scoped
                        // ETA lives here; the queue-wide ETA + elapsed
                        // sit on the bar row below to keep them visually
                        // separated.
                        Text({
                            text: () => {
                                const prog = getImportProgress();
                                if (prog === null) return "";
                                const parts: string[] = [];
                                const isActionListPhase =
                                    prog.phase === "reading" ||
                                    prog.phase === "hydrating" ||
                                    prog.phase === "diffing" ||
                                    prog.phase === "applying";
                                if (isActionListPhase && prog.unitTotal > 1) {
                                    if (prog.phase === "reading") {
                                        parts.push(`${prog.unitCompleted} read so far`);
                                    } else {
                                        parts.push(
                                            `step ${prog.unitCompleted} of ${prog.unitTotal}`
                                        );
                                    }
                                }
                                const eta = currentPhaseEtaText();
                                if (eta.length > 0) parts.push(eta);
                                return parts.join("  ·  ");
                            },
                            color: COLOR_TEXT_DIM,
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
                                    style: { width: { kind: "px", value: 30 } },
                                }),
                                // Queue-wide ETA on the bar row, paired
                                // with elapsed for direct comparison.
                                // Includes a wall-clock finish-time
                                // prediction so the user can compare it
                                // to when the import actually completes.
                                Text({
                                    text: () => {
                                        const eta = progressEtaText();
                                        if (eta === "") return "";
                                        if (eta === "total ETA calculating…") return eta;
                                        if (!progressEtaIsStable()) {
                                            return `total provisional ${eta} left`;
                                        }
                                        const finish = progressFinishTimeText();
                                        if (finish === "") return `total ${eta} left`;
                                        return `total ${eta} left · ${finish}`;
                                    },
                                    color: COLOR_TEXT_DIM,
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
            padding: { side: "left", value: 6 },
            gap: 6,
            height: { kind: "px", value: SIZE_ROW_H + 4 },
            background: COLOR_ROW,
        },
        children: [
            Text({
                text: "House:",
                color: COLOR_TEXT_DIM,
            }),
            // Alias-or-UUID + faint UUID tail. Width is `grow` so a long
            // alias can't push the right-aligned toggles off the row — the
            // toggles keep their fixed widths and the text gets the rest.
            // The Trust button paints AFTER this text in render order, so
            // any visual overflow from a long alias is cleanly masked by
            // the Trust button's background instead of bleeding through.
            Text({
                style: { width: { kind: "grow" } },
                text: () => {
                    const uuid = getHousingUuid();
                    if (uuid === null) return "(unknown — open Knowledge tab to detect)";
                    const alias = getAlias(uuid);
                    if (alias === null) return shortUuid(uuid);
                    return `${alias} §8${shortUuid(uuid)}`;
                },
                color: COLOR_TEXT,
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
            Container({
                style: {
                    direction: "col",
                    align: "center",
                    justify: "center",
                    width: { kind: "px", value: 18 },
                    height: { kind: "grow" },
                    background: () => (isImportSoundsMuted() ? TRUST_ON_BG : COLOR_BUTTON),
                    hoverBackground: () =>
                        isImportSoundsMuted() ? TRUST_ON_HOVER : COLOR_BUTTON_HOVER,
                },
                onClick: (_rect, info) => {
                    if (info.button !== 0) return;
                    setImportSoundsMuted(!isImportSoundsMuted());
                },
                children: [
                    Icon({
                        name: () =>
                            isImportSoundsMuted() ? Icons.volumeOff : Icons.volume2,
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
                    const rows: Child[] = [];
                    for (let i = 0; i < items.length; i++) {
                        const item = items[i];
                        rows.push(queueRow(item));
                        if (item.kind === "importJson" && isQueueImportJsonExpanded(item)) {
                            const children = queueImportJsonChildren(item);
                            for (let j = 0; j < children.length; j++) {
                                rows.push(queueImportJsonChildRow(item, children[j]));
                            }
                        }
                    }
                    return rows;
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
