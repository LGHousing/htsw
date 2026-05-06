/// <reference types="../../../CTAutocomplete" />

import type { Child, Element } from "../lib/layout";
import { getScrollState, setScrollOffset } from "../lib/layout";
import { Button, Col, Container, Row, Scroll, Text } from "../lib/components";
import {
    ACCENT_SUCCESS,
    COLOR_BUTTON_DANGER,
    COLOR_BUTTON_DANGER_HOVER,
    COLOR_PANEL_BORDER,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
} from "../lib/theme";
import { TaskManager } from "../../tasks/manager";
import {
    getCurrentImportingPath,
    getImportEtaSeconds,
    getImportProgress,
    getImportProgressFraction,
} from "../state";
import { diffKey, getDiffEntry } from "../state/diff";
import { actionsToLines, parseHtslFile } from "../state/htsl-render";
import { normalizeHtswPath } from "../lib/pathDisplay";
import { htslDiffLines } from "../right-panel";

const SCROLL_ID = "live-importer-htsl";
// Matches `LINE_H` in `gui/right-panel/index.ts` — that's what `lineRow`
// uses inside `htslDiffLines`, so each rendered htsl line is this tall.
const LINE_H = 10;

// Use the panel-border color (visibly lighter than COLOR_PANEL) so the
// empty channel reads as "an empty bar" instead of vanishing into the
// surrounding panel bg at 0% progress. 6px tall so it's a clear stripe.
const COLOR_BAR_BG = COLOR_PANEL_BORDER;
const COLOR_BAR_FG = ACCENT_SUCCESS;
const PROGRESS_BAR_H = 6;

function progressBar(): Element {
    return Container({
        style: {
            // Without `direction: "row"` the two children stack along the
            // 4px-tall main axis (col is the default). The green child
            // would grow vertically instead of horizontally, so the bar
            // would either be all-green or all-dark with nothing in
            // between — exactly the "always 100% green" symptom.
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

function etaText(): string {
    const p = getImportProgress();
    const secs = getImportEtaSeconds();
    if (secs === null) return p === null ? "" : "calculating";
    const text = formatEtaSeconds(secs);
    if (p !== null && p.etaConfidence === "rough") return `${text} rough`;
    if (p !== null && p.etaConfidence === "informed") return `${text} informed`;
    return text;
}

function percentText(): string {
    return `${Math.floor(getImportProgressFraction() * 100)}%`;
}

function unitText(): string {
    const p = getImportProgress();
    if (p === null || p.unitTotal <= 0) return "";
    return `${p.unitCompleted}/${p.unitTotal}`;
}

function headerRow(): Element {
    return Row({
        style: { gap: 6, height: { kind: "px", value: 12 }, align: "center" },
        children: [
            Text({
                text: () => {
                    const p = getImportProgress();
                    if (p === null) return "Idle";
                    return percentText();
                },
                color: COLOR_TEXT_DIM,
                style: { width: { kind: "px", value: 34 } },
            }),
            Text({
                text: () => {
                    const p = getImportProgress();
                    if (p === null) return "no import in flight";
                    return `${p.currentLabel} · ${p.completed + 1}/${p.total}`;
                },
                color: () => (getImportProgress() === null ? COLOR_TEXT_FAINT : COLOR_TEXT),
                style: { width: { kind: "grow" } },
            }),
            Text({
                text: () => etaText(),
                color: COLOR_TEXT_DIM,
            }),
            // Cancel button — only meaningful while an import is in flight.
            // `TaskManager.cancelAll()` flips the cancel flag on the running
            // TaskContext; the next `ctx.sleep`/`ctx.runCommand`/etc. throws
            // a `__taskCancelled` error which TaskManager catches and logs
            // as "Task cancelled".
            Button({
                text: "✕ Cancel",
                style: {
                    width: { kind: "px", value: 50 },
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
    });
}

function phaseRow(): Element {
    return Row({
        style: { gap: 6, height: { kind: "px", value: 10 }, align: "center" },
        children: [
            Text({
                text: () => {
                    const p = getImportProgress();
                    if (p === null) return "";
                    const unit = unitText();
                    return unit.length === 0
                        ? `${p.phase} · ${p.phaseLabel}`
                        : `${p.phase} · ${p.phaseLabel} · ${unit}`;
                },
                color: COLOR_TEXT_DIM,
                style: { width: { kind: "grow" } },
            }),
        ],
    });
}

function pathRow(): Element {
    return Text({
        text: () => {
            const p = getCurrentImportingPath();
            return p === null ? "" : `→ ${normalizeHtswPath(p)}`;
        },
        color: COLOR_TEXT_FAINT,
        style: { width: { kind: "grow" } },
    });
}

function autoScrollToCurrent(path: string): void {
    const entry = getDiffEntry(diffKey(path));
    if (entry === undefined || entry.currentIndex === null) return;
    const parsed = parseHtslFile(path);
    if (parsed.parseError !== null) return;
    const lines = actionsToLines(parsed.actions);
    let firstLineIdx = -1;
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].actionIndex === entry.currentIndex) {
            firstLineIdx = i;
            break;
        }
    }
    if (firstLineIdx < 0) return;
    const state = getScrollState(SCROLL_ID);
    if (state.viewportRect.h <= 0) return;
    const targetY = firstLineIdx * LINE_H;
    const desired = Math.max(
        0,
        targetY - Math.floor(state.viewportRect.h / 2) + Math.floor(LINE_H / 2)
    );
    setScrollOffset(SCROLL_ID, desired);
}

function htslView(): Element {
    return Scroll({
        id: SCROLL_ID,
        style: { gap: 0, height: { kind: "grow" } },
        children: () => {
            const path = getCurrentImportingPath();
            if (path === null) return [];
            // Pre-sync read phase: the sink hasn't fired any events yet,
            // so the action-by-action diff view has nothing to color.
            // Tell the user explicitly what's happening instead of showing
            // a wall of gray "unknown" lines.
            const entry = getDiffEntry(diffKey(path));
            const hasState =
                entry !== undefined &&
                (entry.states.size > 0 || entry.currentIndex !== null);
            if (!hasState) {
                return [
                    Text({
                        text: () => {
                            const p = getImportProgress();
                            return p === null ? "Reading housing state..." : p.phaseLabel;
                        },
                        color: COLOR_TEXT_DIM,
                        style: { padding: 6 },
                    }),
                    Text({
                        text: () => {
                            const p = getImportProgress();
                            if (p === null || p.unitTotal <= 0) {
                                return "(Trust mode can skip known-current work)";
                            }
                            return `${p.unitCompleted}/${p.unitTotal} · ${etaText()}`;
                        },
                        color: COLOR_TEXT_FAINT,
                        style: { padding: { side: "x", value: 6 } },
                    }),
                ];
            }
            autoScrollToCurrent(path);
            const out: Child[] = htslDiffLines(path);
            return out;
        },
    });
}

function idleView(): Element {
    return Container({
        style: {
            width: { kind: "grow" },
            height: { kind: "grow" },
            align: "center",
        },
        children: [
            Text({
                text: "live importer · idle",
                color: COLOR_TEXT_FAINT,
            }),
        ],
    });
}

export function LiveImporter(): Element {
    return Container({
        style: {
            width: { kind: "grow" },
            height: { kind: "grow" },
            padding: 4,
        },
        children: () => {
            if (getImportProgress() === null) return [idleView()];
            return [
                Col({
                    style: {
                        width: { kind: "grow" },
                        height: { kind: "grow" },
                        gap: 3,
                    },
                    children: [progressBar(), headerRow(), pathRow(), phaseRow(), htslView()],
                }),
            ];
        },
    });
}
