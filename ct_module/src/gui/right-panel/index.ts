/// <reference types="../../../CTAutocomplete" />

import { Child, ClickInfo, Element, Rect } from "../lib/layout";
import { Col, Container, Row, Scroll, Text } from "../lib/components";
import {
    closeTab,
    confirmSelect,
    getActivePath,
    getTabs,
    moveTab,
    moveTabToEnd,
    moveTabToStart,
    setActiveTab,
    Tab,
    tabIndex,
    tabCount,
} from "../state/selection";
import { openMenu, MenuAction } from "../lib/menu";
import { ACCENT_INFO, COLOR_TEXT, COLOR_TEXT_DIM, COLOR_TEXT_FAINT, GLYPH_X } from "../lib/theme";
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
    getCurrentImportingPath,
    getImportEtaSeconds,
    getImportProgress,
    getImportProgressFraction,
    getParsedResult,
} from "../state";
import { normalizeHtswPath } from "../lib/pathDisplay";

/** Sentinel "path" for the synthetic Progress tab the right panel injects
 * while an import is running. Not a real file — picked to never collide
 * with a filesystem path on either Windows or POSIX. */
export const PROGRESS_TAB_PATH = "<htsw:progress>";

export function isProgressTab(path: string | null): boolean {
    return path === PROGRESS_TAB_PATH;
}

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
const COLOR_TAB_CLOSE = 0xffaaaaaa | 0;
const COLOR_TAB_CLOSE_BG_HOVER = 0x40e85c5c | 0;

function tabReorderActions(path: string): MenuAction[] {
    const idx = tabIndex(path);
    const total = tabCount();
    const out: MenuAction[] = [];
    out.push({
        label: "Move left",
        onClick: () => moveTab(path, -1),
    });
    out.push({
        label: "Move right",
        onClick: () => moveTab(path, +1),
    });
    out.push({ kind: "separator" });
    out.push({
        label: "Move to start",
        onClick: () => moveTabToStart(path),
    });
    out.push({
        label: "Move to end",
        onClick: () => moveTabToEnd(path),
    });
    out.push({ kind: "separator" });
    out.push({
        label: "Close tab",
        onClick: () => closeTab(path),
    });
    // Reference idx/total so unused-var lint stays quiet — and it's a useful
    // sanity check if we ever want to disable specific entries based on
    // position (e.g. greying out "Move left" when already first).
    void idx;
    void total;
    return out;
}

function progressTabButton(): Element {
    const isActive = getActivePath() === PROGRESS_TAB_PATH;
    const labelText = `§l${Math.floor(getImportProgressFraction() * 100)}% Progress`;
    const tabBg = isActive ? TAB_BG_ACTIVE : TAB_BG;
    const tabHoverBg = isActive ? TAB_BG_ACTIVE_HOVER : TAB_BG_HOVER;
    const labelW = Renderer.getStringWidth(labelText);
    const tabW = labelW + TAB_LABEL_PAD_X * 2 + TAB_W_BUFFER;
    return Container({
        style: {
            direction: "row",
            align: "center",
            width: { kind: "px", value: tabW },
            height: { kind: "grow" },
            background: tabBg,
            hoverBackground: tabHoverBg,
        },
        onClick: (_rect, info) => {
            if (info.button !== 0) return;
            setActiveTab(PROGRESS_TAB_PATH);
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
                children: [Text({ text: labelText, color: ACCENT_INFO })],
            }),
        ],
    });
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
            // Close [x]. `direction: col` + `align: center` puts the glyph
            // on the cell's horizontal centre; the inner Text takes the full
            // height so its built-in vertical centering kicks in too.
            Container({
                style: {
                    direction: "col",
                    width: { kind: "px", value: TAB_CLOSE_W },
                    height: { kind: "grow" },
                    align: "center",
                    hoverBackground: COLOR_TAB_CLOSE_BG_HOVER,
                },
                onClick: (_rect, info) => {
                    if (info.button !== 0) return;
                    closeTab(tab.path);
                },
                children: [
                    Text({
                        text: GLYPH_X,
                        color: COLOR_TAB_CLOSE,
                        style: { height: { kind: "grow" } },
                    }),
                ],
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

function progressEtaText(): string {
    const p = getImportProgress();
    const secs = getImportEtaSeconds();
    if (secs === null) return p === null ? "" : "calculating…";
    const text = formatEtaSeconds(secs);
    if (p !== null && p.etaConfidence === "rough") return `${text} rough`;
    if (p !== null && p.etaConfidence === "informed") return `${text} informed`;
    return text;
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

function progressView(): Child[] {
    const p = getImportProgress();
    if (p === null) {
        return [
            Text({
                text: "No import in progress.",
                color: COLOR_TEXT_DIM,
                style: { padding: 6 },
            }),
        ];
    }
    const out: Child[] = [];
    out.push(
        Container({
            style: {
                width: { kind: "grow" },
                padding: { side: "x", value: 6 },
                height: { kind: "px", value: 12 },
                align: "center",
            },
            children: [
                Text({ text: "Currently", color: COLOR_TEXT_FAINT }),
            ],
        })
    );
    out.push(
        Container({
            style: {
                width: { kind: "grow" },
                padding: { side: "x", value: 6 },
                height: { kind: "px", value: 12 },
                align: "center",
            },
            children: [
                Text({
                    text: () => `§l${progressCurrentLabel()}`,
                    color: COLOR_TEXT,
                }),
            ],
        })
    );
    out.push(
        Container({
            style: {
                width: { kind: "grow" },
                padding: { side: "x", value: 6 },
                height: { kind: "px", value: 12 },
                align: "center",
            },
            children: [
                Text({
                    text: () => {
                        const prog = getImportProgress();
                        if (prog === null) return "";
                        const parts: string[] = [];
                        parts.push(`${prog.phase} · ${prog.phaseLabel}`);
                        if (prog.unitTotal > 0) parts.push(`${prog.unitCompleted}/${prog.unitTotal}`);
                        parts.push(progressEtaText());
                        return parts.filter((s) => s.length > 0).join("  ·  ");
                    },
                    color: COLOR_TEXT_DIM,
                }),
            ],
        })
    );
    out.push(
        Container({
            style: {
                width: { kind: "grow" },
                padding: { side: "x", value: 6 },
                height: { kind: "px", value: 12 },
                align: "center",
            },
            children: [
                Text({
                    text: () => {
                        const path = getCurrentImportingPath();
                        return path === null ? "" : `→ ${normalizeHtswPath(path)}`;
                    },
                    color: COLOR_TEXT_FAINT,
                }),
            ],
        })
    );
    out.push(
        Container({
            style: {
                width: { kind: "grow" },
                padding: { side: "x", value: 6 },
                height: { kind: "px", value: 12 },
                align: "center",
            },
            children: [
                Text({
                    text: () => `${p.completed + 1}/${p.total} importable · ${p.currentIdentity}`,
                    color: COLOR_TEXT_FAINT,
                }),
            ],
        })
    );
    // Spacer between header and diff context.
    out.push(
        Container({
            style: { width: { kind: "grow" }, height: { kind: "px", value: 4 } },
            children: [],
        })
    );
    const path = getCurrentImportingPath();
    if (path !== null && path.toLowerCase().endsWith(".htsl")) {
        const lines = htslDiffLines(path, { focusCurrent: true, before: 3, after: 6 });
        for (const ln of lines) out.push(ln);
    }
    return out;
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
            if (active === PROGRESS_TAB_PATH) return progressView();
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
            if (p === null || p === PROGRESS_TAB_PATH) return "";
            return displayPath(p);
        },
        color: 0xff888888 | 0,
        style: { width: { kind: "grow" } },
    });
}

export function RightPanel(): Element {
    return Col({
        style: { padding: 6, gap: 4, width: { kind: "grow" }, height: { kind: "grow" } },
        children: [
            Row({
                style: { gap: 2, height: { kind: "px", value: TAB_H } },
                children: () => {
                    const out: Element[] = [];
                    if (getImportProgress() !== null) out.push(progressTabButton());
                    for (const tab of getTabs()) out.push(tabButton(tab));
                    return out;
                },
            }),
            pathLabel(),
            sourceBody(),
        ],
    });
}

export const RightRail = RightPanel;
