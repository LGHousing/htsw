/// <reference types="../../../../CTAutocomplete" />

/**
 * Live importer progress display: the panel that shows WHO/WHAT/HOW-FAR
 * during an import, plus the multi-phase progress bar and ETA / clock-time
 * text. The snapshot-segment helpers are exported so the per-queue-row mini
 * bar (in `queueRows.ts`) renders the same fills as the footer bar.
 */

import type { Element } from "../../lib/layout";
import { Button, Col, Container, Row, Text } from "../../lib/components";
import { Icons } from "../../lib/icons.generated";
import {
    ACCENT_DANGER,
    ACCENT_INFO,
    ACCENT_SUCCESS,
    ACCENT_TEAL,
    COLOR_BUTTON_DANGER,
    COLOR_BUTTON_DANGER_HOVER,
    COLOR_PANEL,
    COLOR_PANEL_BORDER,
    COLOR_PANEL_RAISED,
    COLOR_TEXT,
    COLOR_TEXT_DIM,
} from "../../lib/theme";
import {
    PHASE_APPLYING,
    PHASE_HYDRATING,
    PHASE_READING,
    PHASE_SCANNED,
} from "./phaseColors";
import { cancelActiveTask } from "../../../tasks/activeTask";
import {
    getCurrentPhaseEtaSeconds,
    getFinishedTaskFailure,
    getTaskElapsedMs,
    getTaskEtaSeconds,
    getTaskEtcMs,
    getTaskProgress,
    getTaskProgressFraction,
    getSessionTrustMode,
    getSessionVerb,
    isEtaEstimating,
    isEtaRough,
    parkedTaskFor,
    phaseFractions,
    setActiveTaskPath,
    setTaskProgress,
    type PhaseUnits,
} from "./taskProgress";
import {
    countTaskRowsByStatus,
    isTaskTotalLocked,
    type MenuSlotFocus,
} from "../../../housingSync/progress/types";

const COLOR_BAR_BG = COLOR_PANEL_BORDER;
const PROGRESS_BAR_H = 6;
const MAX_DETAILED_PROGRESS_ROWS = 128;

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

function progressElapsedText(): string {
    const ms = getTaskElapsedMs();
    if (ms === null) return "";
    return `§7${formatEtaSeconds(ms / 1000)}`;
}

const PHASE_LABELS: { [k: string]: { title: string; etaSuffix: string } | undefined } = {
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

/**
 * A menu writes slot by slot, so its most useful "where am I" is the grid slot
 * (and the item going into it), not the current slot's action-list op count.
 * Returns the parts to show in place of `opCounterText` while a slot is active.
 */
function menuSlotParts(slot: MenuSlotFocus, phase: string): string[] {
    const named = slot.label !== null && slot.label.length > 0 ? ` (${slot.label})` : "";
    const parts: string[] = [];
    if (slot.count > 1) {
        parts.push(
            `${phase === "applying" ? "step" : "item"} ${slot.index}/${slot.count}`
        );
    }
    parts.push(`slot ${slot.slot}${named}`);
    return parts;
}

function phaseEtaText(suffix: string): string {
    // Show a phase countdown only when this phase's size is actually known:
    //   - hydrating: the hydration plan gives exact units at phase start
    //   - applying:  the diff is computed, op count fixed
    // Setup and reading are discovery — their totals aren't known
    // yet, so a countdown there would be invented. (Reading also self-
    // suppresses: its remaining stays ~0 until the read finishes.)
    const p = getTaskProgress();
    const phase = p !== null && p.active !== null ? p.active.phase : null;
    const phaseKnown = phase === "hydrating" || phase === "applying" || phase === "done";
    if (p !== null && !phaseKnown) return "";
    const secs = getCurrentPhaseEtaSeconds();
    if (secs === null || secs <= 0) return "";
    return `${formatEtaSeconds(secs)} left ${suffix}`;
}

function currentPhaseLabel(): string {
    const p = getTaskProgress();
    if (p === null || p.active === null) return "";
    const labels = PHASE_LABELS[p.active.phase];
    if (labels === undefined) return "§lDone";
    const title = isEtaEstimating() ? "Scanning" : labels.title;
    const etaSuffix = isEtaEstimating() ? "scan" : labels.etaSuffix;
    const parts: string[] = [];
    const slot = p.active.currentSlot;
    if (slot != null && p.active.type === "MENU") {
        for (const part of menuSlotParts(slot, p.active.phase)) parts.push(part);
    } else {
        const counter = opCounterText();
        if (counter.length > 0) parts.push(counter);
    }
    const eta = phaseEtaText(etaSuffix);
    if (eta.length > 0) parts.push(eta);
    return parts.length > 0 ? `§l${title}§r  ·  ${parts.join("  ·  ")}` : `§l${title}`;
}

// ── Progress bar geometry ──────────────────────────────────────────────

/**
 * A horizontal track slice that fills proportionally with `fraction` (0–1)
 * of its allotted `widthFactor`. Used for one phase of the multi-phase
 * progress bar (reading/hydrating/applying) and reused by `queue.ts`'s
 * per-row mini bar.
 */
function phaseSegment(
    widthFactor: number,
    fraction: number,
    color: number,
    trackColor?: number
): Element {
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
                    background: fraction >= 1 ? undefined : trackColor,
                },
                children: [],
            }),
        ],
    });
}

type PhaseSnapshot = {
    phase: "setup" | "reading" | "hydrating" | "applying" | "done";
    phaseUnits: PhaseUnits;
    completedUnits: number;
};

/**
 * Three sub-slices sized by each phase's unit count, each filling with that
 * phase's completion. Used by the queue-row mini bars, where one row has the
 * whole bar's width to show intra-importable detail.
 */
function taskPhaseSliceSegments(snapshot: PhaseSnapshot): Element[] {
    const units = snapshot.phaseUnits;
    const total = units.setup + units.reading + units.hydrating + units.applying;
    // All-zero phase units would give the three slices equal floor grow
    // factors — the layout normalizes those to filled-looking thirds, a
    // fake blue/purple flash. Render a plain empty track instead.
    if (total <= 0) return [phaseSegment(1, 0, PHASE_READING)];
    const f = phaseFractions(units, snapshot.completedUnits);
    return [
        phaseSegment(f.readingUnits / total, f.readFraction, PHASE_READING),
        phaseSegment(units.hydrating / total, f.hydrateFraction, PHASE_HYDRATING),
        phaseSegment(units.applying / total, f.applyFraction, PHASE_APPLYING),
    ];
}

/**
 * One segment per importable: the current phase's color filling across the
 * previous phase's solid color. A phase that finished leaves the segment
 * solid in its color (read → blue, hydrated → purple, applied → green), so
 * the footer bar reads left-to-right as green / purple / blue bands with at
 * most one partially-filled segment per pass.
 */
function taskPhaseFillSegments(snapshot: PhaseSnapshot): Element[] {
    const f = phaseFractions(snapshot.phaseUnits, snapshot.completedUnits);
    if (snapshot.phase === "done") {
        return [phaseSegment(1, 1, PHASE_APPLYING)];
    }
    if (snapshot.phase === "applying") {
        return [phaseSegment(1, f.applyFraction, PHASE_APPLYING, PHASE_HYDRATING)];
    }
    if (snapshot.phase === "hydrating") {
        return [phaseSegment(1, f.hydrateFraction, PHASE_HYDRATING, PHASE_READING)];
    }
    return [phaseSegment(1, f.readFraction, PHASE_READING)];
}

/**
 * Segments for the importable currently being worked on. During the export
 * scan pass the phase-unit math has nothing to show (a scan credits almost
 * no units), so the segment fills solid reading-blue while its scan runs.
 * `style` picks the renderer: "slices" for the queue-row mini bars, "fill"
 * for the footer bar's per-importable segments.
 */
export function currentSnapshotSegments(
    snapshot: PhaseSnapshot,
    style: "slices" | "fill"
): Element[] {
    if (isEtaEstimating()) return [phaseSegment(1, 1, PHASE_READING)];
    return style === "slices"
        ? taskPhaseSliceSegments(snapshot)
        : taskPhaseFillSegments(snapshot);
}

/**
 * Segments for a parked importable. One still parked in the read phase has
 * only been scanned — show the dim "scanned" fill instead of phase math
 * over an almost entirely unstarted estimate (which renders as empty).
 */
export function parkedSnapshotSegments(
    snapshot: PhaseSnapshot,
    style: "slices" | "fill"
): Element[] {
    if (snapshot.phase === "setup" || snapshot.phase === "reading") {
        return [phaseSegment(1, 1, PHASE_SCANNED)];
    }
    return style === "slices"
        ? taskPhaseSliceSegments(snapshot)
        : taskPhaseFillSegments(snapshot);
}

function activeRowPhaseChildren(): Element[] {
    const p = getTaskProgress();
    if (p === null || p.active === null) return [];
    return currentSnapshotSegments(p.active, "fill");
}

function parkedRowPhaseChildren(key: string): Element[] {
    const p = getTaskProgress();
    if (p === null) return [];
    const parked = parkedTaskFor(p, key);
    if (parked === undefined) return [];
    return parkedSnapshotSegments(parked, "fill");
}

function compactProgressBarChildren(): Element[] {
    const p = getTaskProgress();
    if (p === null) return [];
    let color = ACCENT_SUCCESS;
    if (p.active?.phase === "reading" || p.active?.phase === "setup") {
        color = PHASE_READING;
    } else if (p.active?.phase === "hydrating") {
        color = PHASE_HYDRATING;
    } else if (p.active?.phase === "applying") {
        color = PHASE_APPLYING;
    } else if (p.failure) color = ACCENT_DANGER;
    return [phaseSegment(1, getTaskProgressFraction(), color)];
}

function segmentDivider(background?: number): Element {
    return Container({
        style: {
            width: { kind: "px", value: 2 },
            height: { kind: "grow" },
            background,
        },
        children: [],
    });
}

function activeSegmentCaret(): Element {
    const step = (w: number): Element =>
        Container({
            style: {
                width: { kind: "px", value: w },
                height: { kind: "px", value: 1 },
                background: ACCENT_INFO,
            },
            children: [],
        });
    return Container({
        style: { direction: "col", align: "center", width: { kind: "auto" } },
        children: [step(5), step(3), step(1)],
    });
}

/**
 * A 3px strip above the footer bar holding a small down-caret centered over
 * the active importable's segment. It mirrors the bar's slot/divider widths
 * so the caret lines up with the segment below without sharing layout state.
 */
function activeSegmentCaretRow(): Element {
    return Container({
        style: {
            direction: "row",
            width: { kind: "grow" },
            height: { kind: "px", value: 3 },
        },
        children: () => {
            const p = getTaskProgress();
            if (p === null || p.totalUnits <= 0 || p.active === null) return [];
            if (p.rows.length > MAX_DETAILED_PROGRESS_ROWS) return [];
            const active = p.active;
            const children: Element[] = [];
            for (let i = 0; i < p.rows.length; i++) {
                if (i > 0) children.push(segmentDivider());
                children.push(
                    Container({
                        style: {
                            direction: "row",
                            width: { kind: "grow" },
                            height: { kind: "grow" },
                            justify: "center",
                        },
                        children:
                            p.rows[i].key === active.key ? [activeSegmentCaret()] : [],
                    })
                );
            }
            return children;
        },
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
            const p = getTaskProgress();
            if (p === null || p.totalUnits <= 0) return [];
            if (p.rows.length > MAX_DETAILED_PROGRESS_ROWS) {
                return compactProgressBarChildren();
            }
            const children: Element[] = [];
            for (let i = 0; i < p.rows.length; i++) {
                const row = p.rows[i];
                if (i > 0) children.push(segmentDivider(COLOR_PANEL));
                if (row.status === "imported") {
                    children.push(phaseSegment(1, 1, ACCENT_SUCCESS));
                } else if (row.status === "skipped") {
                    children.push(phaseSegment(1, 1, ACCENT_TEAL));
                } else if (row.status === "failed") {
                    children.push(phaseSegment(1, 1, ACCENT_DANGER));
                } else if (p.active !== null && p.active.key === row.key) {
                    children.push(
                        Container({
                            style: {
                                direction: "row",
                                width: { kind: "grow" },
                                height: { kind: "grow" },
                            },
                            children: activeRowPhaseChildren(),
                        })
                    );
                } else if (parkedTaskFor(p, row.key) !== undefined) {
                    // The read/hydrate pass finished this row but the apply
                    // pass hasn't reached it yet. Show the parked phase fill
                    // so the segment doesn't visually rewind.
                    children.push(
                        Container({
                            style: {
                                direction: "row",
                                width: { kind: "grow" },
                                height: { kind: "grow" },
                            },
                            children: parkedRowPhaseChildren(row.key),
                        })
                    );
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

function progressTotalEtaLine(): string {
    const p = getTaskProgress();
    if (p === null) return "";
    if (isEtaEstimating()) return "total estimating...";
    // Until the apply phase, the per-importable apply cost is just a rough
    // guess — the real op-by-op diff isn't known until each importable has
    // been read + hydrated. Showing a total before then is fiction, so we
    // withhold it (the per-phase ETA still ticks).
    const ready = isTaskTotalLocked(p);
    if (!ready) {
        return "total estimating…";
    }
    const secs = getTaskEtaSeconds();
    if (secs === null) return "total estimating…";
    const etc = getTaskEtcMs();
    const etcText = etc === null ? "" : ` · ends ${formatClockTime(etc)}`;
    // "~" marks a session whose item sizes are pure fallbacks (nothing cached
    // or parsed to size from), so the total is a guess, not an estimate.
    const rough = isEtaRough() ? "~" : "";
    return `total ${rough}${formatEtaSeconds(secs)}${etcText}`;
}

function knowledgeSourceText(): string {
    if (getSessionVerb() !== "import") return "";
    const knowledge = getTaskProgress()?.active?.knowledge;
    if (knowledge == null) return "";
    if (knowledge.currentReason === "lock-verification") {
        return "Source: Checking house against house.lock";
    }

    // An untrusted session was never going to use the cache, so the lock
    // chips ("cache matches lock", …) only read as a cache problem that
    // isn't there. Say why the house is being read instead.
    const trustOff = getSessionTrustMode() === false;

    let source: string;
    if (knowledge.usedHouse && knowledge.usedCache) {
        source = "Reading changes, rest from cache";
    } else if (knowledge.usedCache) {
        source = "Trusted cache";
    } else if (knowledge.usedHouse) {
        source =
            knowledge.currentReason === "shell-read"
                ? "Reading house shell"
                : trustOff
                  ? "Full read"
                  : "Full house read";
    } else {
        source = "Known empty house state";
    }

    const lock = trustOff
        ? " · trust off"
        : knowledge.currentReason === "lock-verified"
          ? " · house verified"
          : knowledge.lockStatus === "matched"
            ? " · cache matches lock"
            : knowledge.lockStatus === "missing"
              ? " · no house.lock entry"
              : knowledge.lockStatus === "mismatch"
                ? " · cache differs from lock"
                : "";
    return `Source: ${source}${lock}`;
}

type ProgressPosition = {
    current: NonNullable<ReturnType<typeof getTaskProgress>>["active"];
    currentNumber: number;
    completedImportables: number;
    failedImportables: number;
    totalImportables: number;
    allDone: boolean;
};

let progressPositionRows: NonNullable<ReturnType<typeof getTaskProgress>>["rows"] | null =
    null;
let progressPositionActiveKey: string | null = null;
let cachedProgressPosition: ProgressPosition | null = null;

function progressPosition(): ProgressPosition | null {
    const p = getTaskProgress();
    if (p === null) {
        progressPositionRows = null;
        progressPositionActiveKey = null;
        cachedProgressPosition = null;
        return null;
    }
    const current = p.active;
    const activeKey = current?.key ?? null;
    if (
        p.rows === progressPositionRows &&
        activeKey === progressPositionActiveKey &&
        cachedProgressPosition !== null
    ) {
        cachedProgressPosition.current = current;
        return cachedProgressPosition;
    }
    progressPositionRows = p.rows;
    progressPositionActiveKey = activeKey;
    const {
        completed: completedImportables,
        failed: failedImportables,
        total: totalImportables,
    } = countTaskRowsByStatus(p);
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
    cachedProgressPosition = {
        current,
        currentNumber,
        completedImportables,
        failedImportables,
        totalImportables,
        allDone,
    };
    return cachedProgressPosition;
}

function progressHeadlineText(): string {
    const pos = progressPosition();
    if (pos === null) return "";
    const verb = getSessionVerb();
    const noun = verb === "export" ? "Export" : verb === "read" ? "Read" : "Importable";
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

function cancelButton(): Element {
    return Button({
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
    });
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
                    knowledgeSourceText().length > 0 &&
                        Text({
                            text: () => knowledgeSourceText(),
                            color: COLOR_TEXT_DIM,
                            truncate: true,
                            style: { width: { kind: "grow" } },
                        }),
                    Col({
                        style: { gap: 1, width: { kind: "grow" } },
                        children: [activeSegmentCaretRow(), progressBar()],
                    }),
                    // The total/ETA text and Cancel button get
                    // separate rows: sharing one row truncated the text to
                    // "total 9m37s - end…" on narrow GUIs.
                    Row({
                        style: {
                            gap: 6,
                            height: { kind: "px", value: 12 },
                            align: "center",
                        },
                        children: [
                            Text({
                                text: () =>
                                    `${Math.floor(getTaskProgressFraction() * 100)}%`,
                                color: COLOR_TEXT,
                                style: { width: { kind: "px", value: 30 } },
                            }),
                            Text({
                                text: () => progressTotalEtaLine(),
                                color: COLOR_TEXT_DIM,
                                truncate: true,
                                style: { width: { kind: "grow" } },
                            }),
                        ],
                    }),
                    Row({
                        style: { gap: 6, height: { kind: "px", value: 12 } },
                        children: [
                            Container({
                                style: {
                                    width: { kind: "grow" },
                                    height: { kind: "px", value: 1 },
                                },
                                children: [],
                            }),
                            cancelButton(),
                        ],
                    }),
                ],
            }),
        ],
    });
}

export function failedTaskFooterPanel(): Element {
    return Container({
        style: {
            width: { kind: "grow" },
            padding: 4,
            background: COLOR_PANEL_RAISED,
        },
        children: [
            Col({
                style: { gap: 3, width: { kind: "grow" } },
                children: [
                    Text({
                        text: "Import failed",
                        color: ACCENT_DANGER,
                    }),
                    Text({
                        text: () => getFinishedTaskFailure() ?? "",
                        color: COLOR_TEXT,
                        truncate: true,
                        tooltip: () => getFinishedTaskFailure() ?? "",
                        style: { width: { kind: "grow" } },
                    }),
                ],
            }),
        ],
    });
}
