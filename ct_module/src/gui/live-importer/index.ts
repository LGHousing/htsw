/// <reference types="../../../CTAutocomplete" />

import type { Child, Element } from "../lib/layout";
import { getScrollState, setScrollOffset } from "../lib/layout";
import { Col, Container, Row, Scroll, Text } from "../lib/components";
import {
    ACCENT_SUCCESS,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
} from "../lib/theme";
import {
    getCurrentImportingPath,
    getImportProgress,
    getImportStartedAt,
} from "../state";
import { diffKey, getDiffEntry } from "../state/diff";
import { actionsToLines, parseHtslFile } from "../state/htsl-render";
import { normalizeHtswPath } from "../lib/pathDisplay";
import { htslDiffLines } from "../right-panel";

const SCROLL_ID = "live-importer-htsl";
// Matches `LINE_H` in `gui/right-panel/index.ts` — that's what `lineRow`
// uses inside `htslDiffLines`, so each rendered htsl line is this tall.
const LINE_H = 10;

const COLOR_BAR_BG = 0xff1a1f25 | 0;
const COLOR_BAR_FG = ACCENT_SUCCESS;

function progressBar(): Element {
    return Container({
        style: {
            width: { kind: "grow" },
            height: { kind: "px", value: 4 },
            background: COLOR_BAR_BG,
        },
        children: () => {
            const p = getImportProgress();
            if (p === null || p.weightTotal <= 0) return [];
            const ratio = Math.min(1, Math.max(0, p.weightCompleted / p.weightTotal));
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

function formatEta(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000));
    if (total < 60) return `~${total}s`;
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m < 60) return s === 0 ? `~${m}m` : `~${m}m${s}s`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm === 0 ? `~${h}h` : `~${h}h${mm}m`;
}

/**
 * Effective work-completion ratio that accounts for in-flight progress
 * inside the current importable. The session only emits coarse progress
 * events at importable boundaries (`weightCompleted` jumps once per
 * importable), so for a 1-importable run the raw value stays at 0 until
 * the very end. We bridge that gap by counting how many actions in the
 * currently-importing function have settled to a non-`unknown` state.
 */
function effectiveWeightRatio(): number {
    const p = getImportProgress();
    if (p === null || p.weightTotal <= 0) return 0;
    const path = getCurrentImportingPath();
    let inFlightFraction = 0;
    if (path !== null) {
        const entry = getDiffEntry(diffKey(path));
        if (entry !== undefined) {
            const parsed = parseHtslFile(path);
            if (parsed.parseError === null && parsed.actions.length > 0) {
                let settled = 0;
                for (let i = 0; i < parsed.actions.length; i++) {
                    const s = entry.states.get(i);
                    if (s !== undefined && s !== "unknown") settled++;
                }
                inFlightFraction = settled / parsed.actions.length;
            }
        }
    }
    const effectiveCompleted =
        p.weightCompleted + p.weightCurrent * inFlightFraction;
    return Math.min(1, Math.max(0, effectiveCompleted / p.weightTotal));
}

function etaText(): string {
    const p = getImportProgress();
    const startedAt = getImportStartedAt();
    if (p === null || startedAt === null) return "";
    const ratio = effectiveWeightRatio();
    if (ratio <= 0) return "—";
    const elapsed = Date.now() - startedAt;
    if (elapsed <= 0) return "—";
    const remaining = (elapsed * (1 - ratio)) / ratio;
    if (!isFinite(remaining) || remaining < 0) return "—";
    return formatEta(remaining);
}

function headerRow(): Element {
    return Row({
        style: { gap: 6, height: { kind: "px", value: 10 }, align: "center" },
        children: [
            Text({
                text: () => {
                    const p = getImportProgress();
                    if (p === null) return "Idle";
                    return `${p.completed}/${p.total}`;
                },
                color: COLOR_TEXT_DIM,
                style: { width: { kind: "px", value: 28 } },
            }),
            Text({
                text: () => {
                    const p = getImportProgress();
                    if (p === null) return "no import in flight";
                    return p.currentLabel;
                },
                color: () => (getImportProgress() === null ? COLOR_TEXT_FAINT : COLOR_TEXT),
                style: { width: { kind: "grow" } },
            }),
            Text({
                text: () => etaText(),
                color: COLOR_TEXT_DIM,
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
                        text: "Reading housing state…",
                        color: COLOR_TEXT_DIM,
                        style: { padding: 6 },
                    }),
                    Text({
                        text: "(Trust mode could speed this up)",
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
                    children: [progressBar(), headerRow(), pathRow(), htslView()],
                }),
            ];
        },
    });
}
