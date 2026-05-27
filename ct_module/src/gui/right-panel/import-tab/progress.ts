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
    getCurrentPhaseEtaSeconds,
    getImportEtaSeconds,
    getImportEtcMs,
    getImportMsPerUnit,
    getImportProgress,
    getImportProgressFraction,
} from "../../state";
import {
    countImportablesByStatus,
    isImportTotalLocked,
} from "../../../importer/progress/types";
import { traceDebugSnapshot } from "../../../importer/progress/trace";

const COLOR_BAR_BG = COLOR_PANEL_BORDER;
const PROGRESS_BAR_H = 6;
let lastProgressBarTrace = "";

// ── Time formatting ────────────────────────────────────────────────────

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

function formatClockTime(ms: number): string {
    const d = new Date(ms);
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12;
    if (h === 0) h = 12;
    const mm = m < 10 ? `0${m}` : `${m}`;
    return `${h}:${mm} ${ampm}`;
}

// ── ETA + label text ───────────────────────────────────────────────────

function progressMsPerUnitText(): string {
    return `${Math.round(getImportMsPerUnit())}ms/u`;
}

function currentPhaseLabel(): string {
    const p = getImportProgress();
    if (p === null || p.active === null) return "";
    const phase = p.active.phase;
    if (phase === "setup" || phase === "reading") {
        return `§lReading ${p.active.identity}`;
    }
    if (phase === "hydrating") return "§lHydrating";
    if (phase === "applying") {
        const counter = applyOpCounterText();
        return counter.length > 0 ? `§lApplying§r  ·  ${counter}` : "§lApplying";
    }
    return "§lDone";
}

function applyOpCounterText(): string {
    const prog = getImportProgress();
    if (prog === null || prog.active === null) return "";
    const sync = prog.active.sync;
    if (sync === null) return "";
    if (sync.parent !== null) {
        return operationProgressText(sync.parent.completedUnits, sync.parent.totalUnits);
    }
    if (sync.totalUnits > 1) {
        return operationProgressText(sync.completedUnits, sync.totalUnits);
    }
    return "";
}

function currentPhaseEtaText(): string {
    const p = getImportProgress();
    if (p === null || p.active === null) return "";
    const phase = p.active.phase;
    if (phase === "applying") return "";
    const secs = getCurrentPhaseEtaSeconds();
    if (secs === null || secs <= 0) return "";
    if (phase === "setup" || phase === "reading") {
        return `${formatEtaSeconds(secs)} left read`;
    }
    if (phase === "hydrating") return `${formatEtaSeconds(secs)} left hydrate`;
    return "";
}

// ── Progress bar geometry ──────────────────────────────────────────────

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

function rowPhaseChildrenFor(snapshot: {
    phaseUnits: { setup: number; reading: number; hydrating: number; applying: number };
    completedUnits: number;
}): Element[] {
    const units = snapshot.phaseUnits;
    const total = Math.max(
        1,
        units.setup + units.reading + units.hydrating + units.applying
    );
    const readingUnits = units.setup + units.reading;
    const within = Math.max(0, snapshot.completedUnits);
    const readingDone = Math.min(readingUnits, within);
    const hydrateDone = Math.min(
        units.hydrating,
        Math.max(0, within - readingUnits)
    );
    const applyDone = Math.min(
        units.applying,
        Math.max(0, within - readingUnits - units.hydrating)
    );
    const readFraction = readingUnits > 0 ? readingDone / readingUnits : 1;
    const hydrateFraction = units.hydrating > 0 ? hydrateDone / units.hydrating : 1;
    const applyFraction = units.applying > 0 ? applyDone / units.applying : 0;
    return [
        phaseSegment(readingUnits / total, readFraction, PHASE_READING),
        phaseSegment(units.hydrating / total, hydrateFraction, PHASE_HYDRATING),
        phaseSegment(units.applying / total, applyFraction, PHASE_APPLYING),
    ];
}

function activeRowPhaseChildren(): Element[] {
    const p = getImportProgress();
    if (p === null || p.active === null) return [];
    return rowPhaseChildrenFor(p.active);
}

function parkedRowPhaseChildren(key: string): Element[] {
    const p = getImportProgress();
    if (p === null) return [];
    const parked = p.parked[key];
    if (parked === undefined) return [];
    return rowPhaseChildrenFor(parked);
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
                if (row.status === "imported" || row.status === "skipped") {
                    children.push(phaseSegment(1, 1, ACCENT_SUCCESS));
                    traceRows.push({ index: i, key: row.key, status: row.status, kind: "done" });
                } else if (row.status === "failed") {
                    children.push(phaseSegment(1, 1, ACCENT_DANGER));
                    traceRows.push({ index: i, key: row.key, status: row.status, kind: "failed" });
                } else if (p.active !== null && p.active.key === row.key) {
                    children.push(Container({
                        style: {
                            direction: "row",
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                        },
                        children: activeRowPhaseChildren(),
                    }));
                    traceRows.push({
                        index: i,
                        key: row.key,
                        status: row.status,
                        kind: "active",
                        activePhase: p.active.phase,
                    });
                } else if (p.parked[row.key] !== undefined) {
                    // Pass-1 finished read/hydrate for this row but pass-2
                    // hasn't reached it yet. Show the parked phase fill so
                    // the segment doesn't visually rewind.
                    children.push(Container({
                        style: {
                            direction: "row",
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                        },
                        children: parkedRowPhaseChildren(row.key),
                    }));
                    traceRows.push({
                        index: i,
                        key: row.key,
                        status: row.status,
                        kind: "parked",
                        parkedPhase: p.parked[row.key].phase,
                    });
                } else {
                    children.push(phaseSegment(1, 0, ACCENT_SUCCESS));
                    traceRows.push({ index: i, key: row.key, status: row.status, kind: "queued" });
                }
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
    if (cur.phase === "applying") return "";
    const parts: string[] = [];
    const sync = cur.sync;
    if (sync !== null && sync.totalUnits > 1) {
        parts.push(operationProgressText(sync.completedUnits, sync.totalUnits));
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
    const p = getImportProgress();
    if (p === null) return "";
    const rate = progressMsPerUnitText();
    const secs = getImportEtaSeconds();
    if (secs === null) return `total ETA calculating… · ${rate}`;
    const phase = p.active?.phase ?? null;
    if (phase === "setup" || phase === "reading") {
        return `total ~?m?s · ${rate}`;
    }
    if (phase === "applying" || phase === "done" || isImportTotalLocked(p)) {
        const etc = getImportEtcMs();
        const etcText = etc === null ? "" : ` · ETC ${formatClockTime(etc)}`;
        return `total ${formatEtaSeconds(secs)}${etcText} · ${rate}`;
    }
    return `total ~${formatEtaSeconds(secs)} · ${rate}`;
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
                        // WHAT — phase-only label, bolded so it dominates.
                        Text({
                            text: () => current === null ? `§lDone` : currentPhaseLabel(),
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
