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
    ACCENT_TEAL,
    COLOR_BUTTON,
    COLOR_BUTTON_DANGER,
    COLOR_BUTTON_DANGER_HOVER,
    COLOR_BUTTON_HOVER,
    COLOR_PANEL,
    COLOR_PANEL_BORDER,
    COLOR_PANEL_RAISED,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
    PHASE_APPLYING,
    PHASE_HYDRATING,
    PHASE_READING,
} from "../../lib/theme";
import {
    getStepAuto,
    requestStepAdvance,
    setStepAuto,
} from "../../../housingSync/stepGate";
import { cancelActiveTask } from "../../../tasks/activeTask";
import { isCurrentHouseTrusted } from "../../state";
import {
    getCurrentPhaseEtaSeconds,
    getTaskElapsedMs,
    getTaskEtaSeconds,
    getTaskEtcMs,
    getTaskMsPerUnit,
    getTaskProgress,
    getTaskProgressFraction,
    getSessionVerb,
    isEtaRough,
    setActiveTaskPath,
    setTaskProgress,
} from "./taskProgress";
import {
    countTaskRowsByStatus,
    isTaskTotalLocked,
} from "../../../housingSync/progress/types";

const COLOR_BAR_BG = COLOR_PANEL_BORDER;
const PROGRESS_BAR_H = 6;

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
    return `${Math.round(getTaskMsPerUnit())}ms/u`;
}

export function progressElapsedText(): string {
    const ms = getTaskElapsedMs();
    if (ms === null) return "";
    return `§7${formatEtaSeconds(ms / 1000)}`;
}

const PHASE_LABELS: { [k: string]: { title: string; etaSuffix: string } } = {
    setup: { title: "Reading", etaSuffix: "read" },
    reading: { title: "Reading", etaSuffix: "read" },
    hydrating: { title: "Hydrating", etaSuffix: "hydrate" },
    applying: { title: "Applying", etaSuffix: "apply" },
};

function opCounterText(): string {
    const prog = getTaskProgress();
    if (prog === null || prog.active === null) return "";
    const sync = prog.active.sync;
    if (sync === null) return "";
    const target = sync.parent ?? sync;
    if (target.totalUnits <= 1) return "";
    return operationProgressText(target.completedUnits, target.totalUnits);
}

function phaseEtaText(suffix: string): string {
    // Show a phase countdown only when this phase's size is actually known:
    //   - hydrating: the hydration plan gives exact units at phase start
    //   - applying:  the diff is computed, op count fixed
    //   - trusted:   real counts up front for every phase
    // Setup and untrusted reading are discovery — their totals aren't known
    // yet, so a countdown there would be invented. (Reading also self-
    // suppresses: its remaining stays ~0 until the read finishes.)
    const p = getTaskProgress();
    const phase = p !== null && p.active !== null ? p.active.phase : null;
    const phaseKnown =
        isCurrentHouseTrusted() ||
        phase === "hydrating" ||
        phase === "applying" ||
        phase === "done";
    if (p !== null && !phaseKnown) return "";
    const secs = getCurrentPhaseEtaSeconds();
    if (secs === null || secs <= 0) return "";
    return `${formatEtaSeconds(secs)} left ${suffix}`;
}

export function currentPhaseLabel(): string {
    const p = getTaskProgress();
    if (p === null || p.active === null) return "";
    if (getSessionVerb() === "export") return "§lExporting";
    if (getSessionVerb() === "read") return "§lReading";
    const labels = PHASE_LABELS[p.active.phase];
    if (labels === undefined) return "§lDone";
    const parts: string[] = [];
    const counter = opCounterText();
    if (counter.length > 0) parts.push(counter);
    const eta = phaseEtaText(labels.etaSuffix);
    if (eta.length > 0) parts.push(eta);
    return parts.length > 0
        ? `§l${labels.title}§r  ·  ${parts.join("  ·  ")}`
        : `§l${labels.title}`;
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
    const p = getTaskProgress();
    if (p === null || p.active === null) return [];
    return rowPhaseChildrenFor(p.active);
}

function parkedRowPhaseChildren(key: string): Element[] {
    const p = getTaskProgress();
    if (p === null) return [];
    const parked = p.parked[key];
    if (parked === undefined) return [];
    return rowPhaseChildrenFor(parked);
}

export function progressBar(): Element {
    return Container({
        style: {
            direction: "row",
            width: { kind: "grow" },
            height: { kind: "px", value: PROGRESS_BAR_H },
            background: COLOR_BAR_BG,
        },
        children: () => {
            const p = getTaskProgress();
            if (p === null || p.totalUnits <= 0) return [];
            const children: Element[] = [];
            for (let i = 0; i < p.rows.length; i++) {
                const row = p.rows[i];
                if (i > 0) {
                    children.push(Container({
                        style: {
                            width: { kind: "px", value: 2 },
                            height: { kind: "grow" },
                            background: COLOR_PANEL,
                        },
                        children: [],
                    }));
                }
                if (row.status === "imported") {
                    children.push(phaseSegment(1, 1, ACCENT_SUCCESS));
                } else if (row.status === "skipped") {
                    children.push(phaseSegment(1, 1, ACCENT_TEAL));
                } else if (row.status === "failed") {
                    children.push(phaseSegment(1, 1, ACCENT_DANGER));
                } else if (p.active !== null && p.active.key === row.key) {
                    children.push(Container({
                        style: {
                            direction: "row",
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                        },
                        children: activeRowPhaseChildren(),
                    }));
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
                } else {
                    children.push(phaseSegment(1, 0, ACCENT_SUCCESS));
                }
            }
            return children;
        },
    });
}

// ── The live task panel ─────────────────────────────────────────────────

function operationProgressText(completed: number, total: number): string {
    const safeTotal = Math.max(1, total);
    const current = Math.min(safeTotal, Math.max(1, completed + 1));
    return `op ${current}/${safeTotal}`;
}

export function progressTotalEtaLine(): string {
    const p = getTaskProgress();
    if (p === null) return "";
    const rate = progressMsPerUnitText();
    // Until the apply phase, the per-importable apply cost is just a rough
    // guess — the real op-by-op diff isn't known until each importable has
    // been read + hydrated. Showing a total before then is fiction, so we
    // withhold it (the per-phase ETA still ticks). Exception: trust on, where
    // cache baselines make every importable's diff cost real from the start.
    const ready = isTaskTotalLocked(p) || isCurrentHouseTrusted();
    if (!ready) {
        return `total calculating… · ${rate}`;
    }
    const secs = getTaskEtaSeconds();
    if (secs === null) return `total calculating… · ${rate}`;
    const etc = getTaskEtcMs();
    const etcText = etc === null ? "" : ` · ETC ${formatClockTime(etc)}`;
    // "~" marks a session whose item sizes are pure fallbacks (nothing cached
    // or parsed to size from), so the total is a guess, not an estimate.
    const rough = isEtaRough() ? "~" : "";
    return `total ${rough}${formatEtaSeconds(secs)}${etcText} · ${rate}`;
}

function progressPosition(): {
    current: NonNullable<ReturnType<typeof getTaskProgress>>["active"];
    currentNumber: number;
    completedImportables: number;
    failedImportables: number;
    totalImportables: number;
    allDone: boolean;
} | null {
    const p = getTaskProgress();
    if (p === null) return null;
    const current = p.active;
    const { completed: completedImportables, failed: failedImportables, total: totalImportables } =
        countTaskRowsByStatus(p);
    const allDone = completedImportables + failedImportables >= totalImportables;
    let currentNumber = completedImportables + 1;
    if (current !== null) {
        for (let i = 0; i < p.rows.length; i++) {
            if (p.rows[i].key === current.key) {
                currentNumber = i + 1;
                break;
            }
        }
    }
    return {
        current,
        currentNumber,
        completedImportables,
        failedImportables,
        totalImportables,
        allDone,
    };
}

export function progressHeadlineText(): string {
    const pos = progressPosition();
    if (pos === null) return "";
    const verb = getSessionVerb();
    const noun =
        verb === "export" ? "Export" : verb === "read" ? "Read" : "Importable";
    const gerund =
        verb === "export" ? "Exporting" : verb === "read" ? "Reading" : "Importing";
    return pos.current !== null
        ? `${noun} ${pos.currentNumber} of ${pos.totalImportables}  ·  §b§l${pos.current.identity}`
        : pos.allDone
          ? `${noun} ${pos.completedImportables} of ${pos.totalImportables}`
          : `${gerund} ${pos.totalImportables} item${pos.totalImportables === 1 ? "" : "s"}…`;
}

function progressStatusText(): string {
    const p = getTaskProgress();
    if (p === null) return "";
    const pos = progressPosition();
    if (pos === null) return "";
    if (p.failure) return `§c§l✖ ${p.failure.message}`;
    if (pos.current !== null) return currentPhaseLabel();
    return pos.allDone ? `§lDone` : `§7Preparing…`;
}

export function progressControlButtons(): Element[] {
    return [
        Button({
            text: () => (getStepAuto() ? "Pause" : "Resume"),
            style: {
                width: { kind: "px", value: 56 },
                height: { kind: "grow" },
                background: COLOR_BUTTON,
                hoverBackground: COLOR_BUTTON_HOVER,
            },
            onClick: () => setStepAuto(!getStepAuto()),
        }),
        ...(getStepAuto()
            ? []
            : [
                  Button({
                      text: "Step",
                      style: {
                          width: { kind: "px", value: 44 },
                          height: { kind: "grow" },
                          background: COLOR_BUTTON,
                          hoverBackground: COLOR_BUTTON_HOVER,
                      },
                      onClick: () => requestStepAdvance(),
                  }),
              ]),
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
                if (getTaskProgress() === null) return;
                cancelActiveTask();
                setTaskProgress(null);
                setActiveTaskPath(null);
                ChatLib.chat(`&c[htsw] cancelling task…`);
            },
        }),
    ];
}

export function liveTaskFooterPanel(): Element {
    return Container({
        style: {
            width: { kind: "grow" },
            padding: 4,
            background: COLOR_PANEL_RAISED,
        },
        children: () => [
            Col({
                style: { gap: 3, width: { kind: "grow" } },
                children: [
                    Row({
                        style: { gap: 6, width: { kind: "grow" }, align: "center" },
                        children: [
                            Text({
                                text: () => progressHeadlineText(),
                                color: COLOR_TEXT,
                                truncate: true,
                                style: { width: { kind: "grow" } },
                            }),
                            Text({
                                text: () => progressElapsedText(),
                                color: COLOR_TEXT_DIM,
                            }),
                        ],
                    }),
                    Text({
                        text: () => progressStatusText(),
                        color: COLOR_TEXT,
                        truncate: true,
                        style: { width: { kind: "grow" } },
                    }),
                    Container({
                        style: { width: { kind: "grow" }, height: { kind: "px", value: 2 } },
                        children: [],
                    }),
                    progressBar(),
                    Row({
                        style: { gap: 6, height: { kind: "px", value: 12 }, align: "center" },
                        children: [
                            Text({
                                text: () => `${Math.floor(getTaskProgressFraction() * 100)}%`,
                                color: COLOR_TEXT,
                                style: { width: { kind: "px", value: 30 } },
                            }),
                            Text({
                                text: () => progressTotalEtaLine(),
                                color: COLOR_TEXT_DIM,
                                truncate: true,
                                style: { width: { kind: "grow" } },
                            }),
                            ...progressControlButtons(),
                        ],
                    }),
                ],
            }),
        ],
    });
}
