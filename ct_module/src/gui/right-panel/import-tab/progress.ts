/// <reference types="../../../../CTAutocomplete" />

/**
 * Live importer progress display: the panel that shows WHO/WHAT/HOW-FAR
 * during an import, plus the multi-phase progress bar and ETA / clock-time
 * text. `phaseSegment` is exported so the per-queue-row mini bar (in
 * `queue.ts`) can reuse the same segmented look.
 */

import type { Element } from "../../lib/layout";
import { Button, Col, Container, Row, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import {
    ACCENT_DANGER,
    ACCENT_SUCCESS,
    COLOR_BUTTON_DANGER,
    COLOR_BUTTON_DANGER_HOVER,
    COLOR_PANEL_BORDER,
    COLOR_PANEL_RAISED,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    PHASE_APPLYING,
    PHASE_HYDRATING,
    PHASE_READING,
} from "../../lib/theme";
import { TaskManager } from "../../../tasks/manager";
import {
    getActiveImportPath,
    getCurrentPhaseEtaSeconds,
    getImportEtaSeconds,
    getImportMsPerUnit,
    getImportProgress,
    getImportProgressFraction,
} from "../../state";
import { getLiveOverlay } from "../../state/importPreviewState";
import {
    countImportablesByStatus,
    isImportTotalLocked,
} from "../../../importer/progress/types";
import { traceDebugSnapshot } from "../../../importer/progress/trace";

const COLOR_BAR_BG = COLOR_PANEL_BORDER;
const COLOR_BAR_FG = ACCENT_SUCCESS;
const PROGRESS_BAR_H = 6;
let lastProgressBarTrace = "";

// ── Time formatting ────────────────────────────────────────────────────

export function formatEtaSeconds(secs: number): string {
    const total = Math.max(0, Math.round(secs));
    if (total < 60) return `${total}s`;
    const m = Math.floor(total / 60);
    const s = total % 60;
    if (m < 60) return s === 0 ? `${m}m` : `${m}m${s}s`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm === 0 ? `${h}h` : `${h}h${mm}m`;
}

function capitalizePhase(phase: string): string {
    // Setup work is rendered as part of the "Reading" phase from the user's POV.
    if (phase === "setup") return "Reading";
    if (phase.length === 0) return phase;
    return phase.charAt(0).toUpperCase() + phase.slice(1);
}

// ── ETA + label text ───────────────────────────────────────────────────

function progressEtaText(): string {
    const p = getImportProgress();
    const secs = getImportEtaSeconds();
    if (secs === null) return p === null ? "" : "total ETA calculating…";
    return formatEtaSeconds(secs);
}

function progressMsPerUnitText(): string {
    return `${Math.round(getImportMsPerUnit())}ms/u`;
}

function currentPhaseEtaText(): string {
    const p = getImportProgress();
    if (p === null || p.active === null) return "";
    const secs = getCurrentPhaseEtaSeconds();
    if (secs === null || secs <= 0) return "";
    if (p.active.phase === "setup" || p.active.phase === "reading") {
        return `${formatEtaSeconds(secs)} left reading`;
    }
    if (p.active.phase === "hydrating") {
        return `${formatEtaSeconds(secs)} left hydrate`;
    }
    if (p.active.phase === "applying") return `${formatEtaSeconds(secs)} left apply`;
    return "";
}

/** What's happening *right now* — the live overlay's current action label. */
function progressCurrentLabel(): string {
    const path = getActiveImportPath();
    if (path !== null) {
        const overlay = getLiveOverlay(path);
        if (overlay !== undefined && overlay.currentLabel.length > 0) {
            return overlay.currentLabel;
        }
    }
    const p = getImportProgress();
    if (p !== null && p.active !== null) {
        return `${p.active.type} ${p.active.identity}`;
    }
    return "working";
}

// ── Progress bar geometry ──────────────────────────────────────────────

function progressPhaseColor(): number {
    const p = getImportProgress();
    if (p === null || p.active === null) return COLOR_BAR_FG;
    if (p.active.phase === "setup" || p.active.phase === "reading") return PHASE_READING;
    if (p.active.phase === "hydrating") return PHASE_HYDRATING;
    if (p.active.phase === "applying") return PHASE_APPLYING;
    return COLOR_BAR_FG;
}

/**
 * A horizontal track slice that fills proportionally with `fraction` (0–1)
 * of its allotted `widthFactor`. Used for one phase of the multi-phase
 * progress bar (reading/hydrating/applying) and reused by `queue.ts`'s
 * per-row mini bar.
 */
export function phaseSegment(widthFactor: number, fraction: number, color: number): Element {
    return Container({
        style: {
            direction: "row",
            width: { kind: "grow", factor: Math.max(0.0001, widthFactor) },
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
            if (p === null || p.totalUnits <= 0) return [];
            const children: Element[] = [];
            const traceRows: unknown[] = [];
            for (let i = 0; i < p.rows.length; i++) {
                const row = p.rows[i];
                let fraction = 0;
                let color = ACCENT_SUCCESS;
                if (row.status === "imported" || row.status === "skipped") {
                    fraction = 1;
                } else if (row.status === "failed") {
                    fraction = 1;
                    color = ACCENT_DANGER;
                } else if (p.active !== null && p.active.key === row.key) {
                    const total = Math.max(1, p.active.totalUnits);
                    fraction = Math.min(1, Math.max(0, p.active.completedUnits / total));
                    color = progressPhaseColor();
                }

                traceRows.push({
                    index: i,
                    key: row.key,
                    status: row.status,
                    rowTotalUnits: row.totalUnits,
                    widthFactor: 1,
                    fillFraction: fraction,
                    color,
                });

                if (i > 0) {
                    children.push(Container({
                        style: {
                            width: { kind: "px", value: 1 },
                            height: { kind: "grow" },
                            background: COLOR_PANEL_BORDER,
                        },
                        children: [],
                    }));
                }
                children.push(phaseSegment(1, fraction, color));
            }
            const traceKey = JSON.stringify({
                completedUnits: p.completedUnits,
                totalUnits: p.totalUnits,
                activeKey: p.active === null ? null : p.active.key,
                activeCompletedUnits: p.active === null ? null : p.active.completedUnits,
                activeTotalUnits: p.active === null ? null : p.active.totalUnits,
                rows: traceRows,
            });
            if (traceKey !== lastProgressBarTrace) {
                lastProgressBarTrace = traceKey;
                traceDebugSnapshot("guiProgressBar", JSON.parse(traceKey));
            }
            return children;
        },
    });
}

// ── The "live importer" panel ──────────────────────────────────────────

function progressDetailLine(): string {
    const prog = getImportProgress();
    if (prog === null || prog.active === null) return "";
    const cur = prog.active;
    const parts: string[] = [];
    const sync = cur.sync;
    if (sync !== null) {
        const { completedUnits, totalUnits, parent } = sync;
        if (cur.phase === "reading" && totalUnits > 1) {
            parts.push(`${completedUnits} read so far`);
        } else if (cur.phase === "hydrating" && totalUnits > 1) {
            parts.push(`${completedUnits} of ${totalUnits} nested reads`);
        } else if (cur.phase === "applying") {
            if (parent !== null) {
                parts.push(operationProgressText(parent.completedUnits, parent.totalUnits));
            } else if (totalUnits > 1) {
                parts.push(operationProgressText(completedUnits, totalUnits));
            }
        }
    }
    const eta = currentPhaseEtaText();
    if (eta.length > 0) parts.push(eta);
    return parts.join("  ·  ");
}

function operationProgressText(completed: number, total: number): string {
    const safeTotal = Math.max(1, total);
    const current = Math.min(safeTotal, Math.max(1, completed + 1));
    return `op ${current}/${safeTotal}`;
}

function progressTotalEtaLine(): string {
    const eta = progressEtaText();
    if (eta === "") return "";
    if (eta === "total ETA calculating…") return eta;
    const p = getImportProgress();
    const rate = progressMsPerUnitText();
    if (p === null || !isImportTotalLocked(p)) return `total ~${eta} · ${rate}`;
    return `total ${eta} · ${rate}`;
}

export function liveImporterPanel(): Element {
    return Container({
        style: {
            width: { kind: "grow" },
            padding: 4,
            background: COLOR_PANEL_RAISED,
        },
        children: () => {
            const p = getImportProgress();
            if (p === null) {
                return [Text({ text: "No import in progress.", color: COLOR_TEXT_DIM })];
            }
            const current = p.active;
            const { completed: completedImportables, total: totalImportables } =
                countImportablesByStatus(p);
            let currentNumber = completedImportables + 1;
            if (current !== null) {
                for (let i = 0; i < p.rows.length; i++) {
                    if (p.rows[i].key === current.key) {
                        currentNumber = i + 1;
                        break;
                    }
                }
            }
            return [
                Col({
                    style: { gap: 3, width: { kind: "grow" } },
                    children: [
                        // WHO — importable (i of N) being worked on.
                        Text({
                            text: () =>
                                current === null
                                    ? `Importable ${completedImportables} of ${totalImportables}`
                                    : `Importable ${currentNumber} of ${totalImportables} · ${current.identity}`,
                            color: COLOR_TEXT,
                        }),
                        // WHAT — phase + current action label, bolded so it dominates.
                        Text({
                            text: () =>
                                current === null
                                    ? `§lDone`
                                    : `§l${capitalizePhase(current.phase)}: ${progressCurrentLabel()}`,
                            color: COLOR_TEXT,
                        }),
                        // HOW FAR within this importable — step counter + per-phase ETA.
                        Text({
                            text: () => progressDetailLine(),
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
                                Text({
                                    text: () => progressTotalEtaLine(),
                                    color: COLOR_TEXT_DIM,
                                    style: { width: { kind: "grow" } },
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
