/// <reference types="../../../CTAutocomplete" />

import { Child, Element } from "../lib/layout";
import { Button, Col, Container, Row, Scroll, Text } from "../lib/components";
import { getTabs, getActivePath, setActiveTab, confirmSelect, Tab } from "../selection";
import { FileSystemFileLoader } from "../../utils/files";
import { actionsToLines, parseHtslFile, type HtslLine } from "../htsl-render";
import {
    COLOR_BY_STATE,
    ROW_BG_BY_STATE,
    diffKey,
    getDiffEntry,
    type DiffState,
} from "../diff-state";
import { getParsedResult } from "../state";

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
    const slash = p.lastIndexOf("/");
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

function tabButton(tab: Tab): Element {
    const isActive = getActivePath() === tab.path;
    const label = tab.confirmed ? stem(tab.path) : `§o${stem(tab.path)}`;
    return Button({
        text: label,
        style: {
            width: { kind: "grow" },
            height: { kind: "grow" },
            background: isActive ? TAB_BG_ACTIVE : TAB_BG,
            hoverBackground: isActive ? TAB_BG_ACTIVE_HOVER : TAB_BG_HOVER,
        },
        onClick: () => setActiveTab(tab.path),
        onDoubleClick: () => confirmSelect(tab.path),
    });
}

function lineRow(
    lineNum: number,
    text: string,
    color: number,
    bg: number | undefined,
    cursor: boolean
): Element {
    const cursorMark = cursor ? ">" : " ";
    return Container({
        style: {
            direction: "row",
            padding: { side: "x", value: 4 },
            gap: 4,
            height: { kind: "px", value: LINE_H },
            background: bg,
        },
        children: [
            Text({
                text: cursorMark,
                color: cursor ? 0xff67a7e8 | 0 : COLOR_GUTTER,
                style: { width: { kind: "px", value: 8 } },
            }),
            Text({
                text: String(lineNum),
                color: COLOR_GUTTER,
                style: { width: { kind: "px", value: 24 } },
            }),
            Text({
                text,
                color,
                style: { width: { kind: "grow" } },
            }),
        ],
    });
}

function indentedText(line: HtslLine): string {
    let prefix = "";
    for (let i = 0; i < line.depth; i++) prefix += "  ";
    return prefix + line.text;
}

function htslDiffLines(path: string): Element[] {
    const parsed = parseHtslFile(path);
    if (parsed.parseError !== null) {
        const errLines = parsed.parseError.split("\n");
        const out: Element[] = [
            lineRow(0, "// parse failed", COLOR_ERROR, undefined, false),
        ];
        for (let i = 0; i < errLines.length; i++) {
            out.push(
                lineRow(
                    0,
                    shortenForDisplay(errLines[i], 60),
                    COLOR_ERROR,
                    undefined,
                    false
                )
            );
        }
        return out;
    }
    const lines = actionsToLines(parsed.actions);
    if (lines.length === 0) {
        return [
            lineRow(1, "// (empty function)", COLOR_GUTTER, undefined, false),
        ];
    }
    const entry = getDiffEntry(diffKey(path));
    const out: Element[] = [];
    for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        const state: DiffState = entry?.states.get(ln.actionIndex) ?? "unknown";
        const isCurrent = entry?.currentIndex === ln.actionIndex;
        const effectiveState: DiffState = isCurrent ? "current" : state;
        const color = COLOR_BY_STATE[effectiveState];
        const bg = ROW_BG_BY_STATE[effectiveState];
        out.push(
            lineRow(
                i + 1,
                shortenForDisplay(indentedText(ln), 80),
                color,
                bg,
                isCurrent
            )
        );
    }
    if (entry !== undefined && entry.currentLabel.length > 0) {
        out.push(
            lineRow(
                lines.length + 1,
                `// ${entry.currentLabel}`,
                0xff67a7e8 | 0,
                undefined,
                false
            )
        );
    }
    return out;
}

function plainTextLines(path: string): Element[] {
    const lines = readPlainLines(path);
    const diags = diagLinesForActive(path);
    const out: Element[] = [];
    for (let i = 0; i < lines.length; i++) {
        const ln = i + 1;
        const bg = bgForDiag(diags.get(ln));
        out.push(lineRow(ln, shortenForDisplay(lines[i], 80), COLOR_PLAIN, bg, false));
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
            const norm = active.replace(/\\/g, "/").toLowerCase();
            const out: Child[] =
                endsWith(norm, ".htsl") ? htslDiffLines(active) : plainTextLines(active);
            return out;
        },
    });
}

/**
 * Render a path as `./...` when it lives under the MC root (using Java's
 * `Path.relativize` for robust separator/case handling), then ellipsize
 * the leading directories if the result is still too long for the
 * right-pane width.
 */
function displayPath(p: string): string {
    let rel = p.replace(/\\/g, "/");
    try {
        // @ts-ignore
        const Paths = Java.type("java.nio.file.Paths");
        const root = Paths.get(".").toAbsolutePath().normalize();
        const target = Paths.get(String(p));
        if (target.isAbsolute()) {
            try {
                const r = root.relativize(target);
                const rs = String(r.toString()).replace(/\\/g, "/");
                if (rs.indexOf("..") !== 0) rel = `./${rs}`;
            } catch (_e) {
                // not under root
            }
        }
    } catch (_e) {
        // fall through to raw path
    }
    if (rel.length > 40) {
        const tail = rel.substring(rel.length - 38);
        return `…${tail}`;
    }
    return rel;
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

export function RightPanel(): Element {
    return Col({
        style: { padding: 6, gap: 4, width: { kind: "grow" }, height: { kind: "grow" } },
        children: [
            Row({
                style: { gap: 2, height: { kind: "px", value: 18 } },
                children: () => getTabs().map(tabButton),
            }),
            pathLabel(),
            sourceBody(),
        ],
    });
}

export const RightRail = RightPanel;
