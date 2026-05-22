/// <reference types="../../../../CTAutocomplete" />

/**
 * Live importer progress display: the panel that shows WHO/WHAT/HOW-FAR
 * during an import, plus the multi-phase progress bar and ETA / clock-time
 * text. `phaseSegment` is exported so the per-queue-row mini bar (in
 * `queue.ts`) can reuse the same segmented look.
 */

import type { Child, Element } from "../../lib/layout";
import { Button, Col, Container, Row, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import {
    ACCENT_SUCCESS,
    COLOR_BUTTON_DANGER,
    COLOR_BUTTON_DANGER_HOVER,
    COLOR_PANEL,
    COLOR_PANEL_BORDER,
    COLOR_PANEL_RAISED,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    COLOR_TEXT_FAINT,
    PHASE_APPLYING,
    PHASE_HYDRATING,
    PHASE_READING,
} from "../../lib/theme";
import { TaskManager } from "../../../tasks/manager";
import {
    getCurrentImportingPath,
    getCurrentPhaseEtaSeconds,
    getImportEtaSeconds,
    getImportProgress,
    getImportProgressFraction,
    getImportStartedAt,
} from "../../state";
import { diffKey, getDiffEntry } from "../../state/diff";

const COLOR_BAR_BG = COLOR_PANEL_BORDER;
const COLOR_BAR_FG = ACCENT_SUCCESS;
const PROGRESS_BAR_H = 6;

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

function capitalizePhase(phase: string): string {
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

function progressEtaIsStable(): boolean {
    const p = getImportProgress();
    if (p === null) return false;
    return p.current === null ||
        p.current.phase === "done" ||
        p.current.phase === "applying";
}

function progressElapsedText(): string {
    const startedAt = getImportStartedAt();
    if (startedAt === null) return "";
    return `elapsed ${formatElapsedSeconds((Date.now() - startedAt) / 1000)}`;
}

function progressFinishTimeText(): string {
    const secs = getImportEtaSeconds();
    if (secs === null) return "";
    const finish = new Date(Date.now() + secs * 1000);
    return `done ${formatClockTime(finish)}`;
}

function currentPhaseEtaText(): string {
    const p = getImportProgress();
    if (p === null || p.current === null) return "";
    const secs = getCurrentPhaseEtaSeconds();
    if (secs === null || secs <= 0) return "";
    if (p.current.phase === "reading") return `${formatEtaSeconds(secs)} left reading`;
    if (p.current.phase === "hydrating") {
        return `${formatEtaSeconds(secs)} left hydrating`;
    }
    if (p.current.phase === "applying") return `${formatEtaSeconds(secs)} left applying`;
    return "";
}

/** What's happening *right now* — prefer the importer's live progress label,
 * then the diff entry's current action label. */
function progressCurrentLabel(): string {
    const p = getImportProgress();
    if (p !== null && p.current !== null && p.current.phaseLabel.length > 0) {
        return p.current.phaseLabel;
    }
    const path = getCurrentImportingPath();
    if (path !== null) {
        const entry = getDiffEntry(diffKey(path));
        if (entry !== undefined && entry.currentLabel.length > 0) {
            return entry.currentLabel;
        }
    }
    if (p !== null && p.current !== null && p.current.label.length > 0) {
        return p.current.label;
    }
    return "working";
}

// ── Progress bar geometry ──────────────────────────────────────────────

function progressPhaseColor(): number {
    const p = getImportProgress();
    if (p === null || p.current === null) return COLOR_BAR_FG;
    if (p.current.phase === "reading") return PHASE_READING;
    if (p.current.phase === "hydrating") return PHASE_HYDRATING;
    if (p.current.phase === "applying") return PHASE_APPLYING;
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

function currentImportablePhaseSegments(
    p: NonNullable<ReturnType<typeof getImportProgress>>
): Child[] {
    const current = p.current;
    if (current === null) return [];
    const units = current.phaseUnits;
    const total = Math.max(1, units.reading + units.hydrating + units.applying);
    const within = Math.max(0, current.completedUnits);
    const readDone = Math.min(units.reading, within);
    const hydrateDone = Math.min(
        units.hydrating,
        Math.max(0, within - units.reading)
    );
    const applyDone = Math.min(
        units.applying,
        Math.max(0, within - units.reading - units.hydrating)
    );
    return [
        phaseSegment(
            units.reading / total,
            units.reading > 0 ? readDone / units.reading : 1,
            PHASE_READING
        ),
        phaseSegment(
            units.hydrating / total,
            units.hydrating > 0 ? hydrateDone / units.hydrating : 1,
            PHASE_HYDRATING
        ),
        phaseSegment(
            units.applying / total,
            units.applying > 0 ? applyDone / units.applying : 0,
            PHASE_APPLYING
        ),
    ];
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
            if (p.rows.length === 0) {
                const ratio = getImportProgressFraction();
                return [
                    Container({
                        style: {
                            width: { kind: "grow", factor: Math.max(0.0001, ratio) },
                            height: { kind: "grow" },
                            background: progressPhaseColor(),
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
            let rowUnitsTotal = 0;
            for (let i = 0; i < p.rows.length; i++) rowUnitsTotal += p.rows[i].units;
            if (rowUnitsTotal <= 0) rowUnitsTotal = 1;
            const out: Child[] = [];
            for (let i = 0; i < p.rows.length; i++) {
                const row = p.rows[i];
                const w = row.units;
                const flexFactor = Math.max(0.0001, w / rowUnitsTotal);
                let fill: number;
                if (row.status === "imported" || row.status === "skipped") {
                    fill = 1;
                } else if (p.current !== null && row.key === p.current.key) {
                    const denom = Math.max(0.0001, p.current.totalUnits);
                    fill = Math.min(1, Math.max(0, p.current.completedUnits / denom));
                } else {
                    fill = 0;
                }
                const currentPhaseSegments =
                    p.current !== null && row.key === p.current.key
                        ? currentImportablePhaseSegments(p)
                        : [];
                out.push(
                    Container({
                        style: {
                            direction: "row",
                            width: { kind: "grow", factor: flexFactor },
                            height: { kind: "grow" },
                        },
                        children:
                            currentPhaseSegments.length > 0
                                ? currentPhaseSegments
                                : [
                                      Container({
                                          style: {
                                              width: { kind: "grow", factor: Math.max(0.0001, fill) },
                                              height: { kind: "grow" },
                                              background:
                                                  p.current !== null && row.key === p.current.key
                                                      ? progressPhaseColor()
                                                      : COLOR_BAR_FG,
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
                if (i < p.rows.length - 1) {
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

// ── The "live importer" panel ──────────────────────────────────────────

function progressDetailLine(): string {
    const prog = getImportProgress();
    if (prog === null || prog.current === null) return "";
    const cur = prog.current;
    const parts: string[] = [];
    const isActionListPhase =
        cur.phase === "reading" || cur.phase === "hydrating" || cur.phase === "applying";
    const unitTotal = cur.unitTotal ?? 0;
    const unitCompleted = cur.unitCompleted ?? 0;
    if (isActionListPhase) {
        if (cur.phase === "reading" && unitTotal > 1) {
            parts.push(`${unitCompleted} read so far`);
        } else if (cur.phase === "hydrating" && unitTotal > 1) {
            parts.push(`${unitCompleted} of ${unitTotal} nested reads`);
        } else if (cur.phase === "applying") {
            if (cur.parentUnitCompleted !== undefined && cur.parentUnitTotal !== undefined) {
                parts.push(`operation ${cur.parentUnitCompleted} of ${cur.parentUnitTotal}`);
                if (unitTotal > 1) {
                    parts.push(`nested operation ${unitCompleted} of ${unitTotal}`);
                }
            } else if (unitTotal > 1) {
                parts.push(`operation ${unitCompleted} of ${unitTotal}`);
            }
        }
    }
    const eta = currentPhaseEtaText();
    if (eta.length > 0) parts.push(eta);
    return parts.join("  ·  ");
}

function progressTotalEtaLine(): string {
    const eta = progressEtaText();
    if (eta === "") return "";
    if (eta === "total ETA calculating…") return eta;
    if (!progressEtaIsStable()) return `total ~${eta} left`;
    const finish = progressFinishTimeText();
    if (finish === "") return `total ${eta} left`;
    return `total ${eta} left · ${finish}`;
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
            const current = p.current;
            let currentNumber = p.completedImportables + 1;
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
                                    ? `Importable ${p.completedImportables} of ${p.totalImportables}`
                                    : `Importable ${currentNumber} of ${p.totalImportables} · ${current.identity}`,
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
