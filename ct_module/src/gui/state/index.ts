/// <reference types="../../../CTAutocomplete" />

import type { ParseResult } from "htsw";
import type { Importable } from "htsw/types";

import type { KnowledgeStatusRow } from "../../knowledge/status";
import type {
    ImportProgress,
    ImportRunRowStatus,
} from "../../importables/importSession";
import { normalizeHtswPath } from "../lib/pathDisplay";
import { getTimingStats } from "../../importer/progress/timing";
import { importableIdentity } from "../../knowledge/paths";
import { trustPlanKey } from "../../knowledge/trust";

export type { ImportRunRowStatus };

export type ImportProgressView = {
    weightCompleted: number;
    weightTotal: number;
    weightCurrent: number;
    currentKey: string;
    currentType: Importable["type"] | null;
    currentIdentity: string;
    orderIndex: number;
    rowStatus: ImportRunRowStatus | null;
    currentLabel: string;
    phase:
        | "starting"
        | "opening"
        | "reading"
        | "hydrating"
        | "diffing"
        | "applying"
        | "writingKnowledge"
        | "done";
    phaseLabel: string;
    unitCompleted: number;
    unitTotal: number;
    estimatedCompleted: number;
    estimatedTotal: number;
    etaConfidence: "rough" | "informed" | "planned";
    completed: number;
    total: number;
    failed: number;
    inFlight: boolean;
};

export type ImportRunRow = {
    key: string;
    type: Importable["type"];
    identity: string;
    order: number;
    status: ImportRunRowStatus;
    phase: ImportProgressView["phase"];
    phaseLabel: string;
    unitCompleted: number;
    unitTotal: number;
};

export type ImportRunState = {
    rows: Map<string, ImportRunRow>;
    order: string[];
    startedAt: number;
};

export type SourceTab = {
    /** Filesystem path of the source file. Identity for the tab. */
    path: string;
    /** Display label (basename + maybe importable name). */
    label: string;
};

let importJsonPath = "./htsw/imports/import.json";
let parsedResult: ParseResult<Importable[]> | null = null;
let parseError: string | null = null;
let selectedImportableId: string | null = null;
/**
 * Resolved filesystem path of the importable currently being processed by
 * the in-flight import session. Drives the LiveImporter panel above the
 * inventory: when set, that file's HTSL is rendered with diff colors;
 * when null, the panel shows an idle state. Cleared by the import's
 * progress callback when the session reports `currentLabel === "done"`.
 */
let currentImportingPath: string | null = null;
/**
 * Set of importable identities (`type:identity` strings) currently checked
 * in the Importables list. Drives multi-import: when non-empty, the bottom
 * toolbar's Import targets exactly these. Empty set = "no checkboxes
 * ticked, fall back to all".
 */
let selectedImportableIds: Set<string> = new Set();
let openTabs: SourceTab[] = [];
let activeTabPath: string | null = null;
let trustMode = false;
let housingUuid: string | null = null;
let knowledgeRows: KnowledgeStatusRow[] = [];
let importProgress: ImportProgressView | null = null;
let importRunState: ImportRunState | null = null;
let lastEstimatedCompleted = 0;
let lastEstimatedTotal = 1;
/**
 * `Date.now()` of the moment the in-flight import started. Captured the
 * first time `setImportProgress` transitions from null to non-null and
 * cleared on the inverse transition.
 */
let importStartedAt: number | null = null;

export function getImportProgressFraction(): number {
    const p = importProgress;
    if (p === null || p.estimatedTotal <= 0) return 0;
    return Math.min(1, Math.max(0, p.estimatedCompleted / p.estimatedTotal));
}

function calibratedMsPerUnit(): number | null {
    const stats = getTimingStats();
    let totalMs = 0;
    let totalUnits = 0;
    for (const kind in stats) {
        const entry = stats[kind];
        if (entry === undefined) continue;
        totalMs += entry.totalMs;
        totalUnits += entry.totalExpectedUnits;
    }
    if (totalUnits <= 0) return null;
    return totalMs / totalUnits;
}

/**
 * Rolling window of completed estimated work units. ETA is based on recent
 * ms/unit, not importable count or phase count.
 */
type EtaSample = { t: number; completed: number };
const ETA_WINDOW_MS = 45000;
const ETA_MIN_WINDOW_MS = 2500;
const ETA_SAMPLE_INTERVAL_MS = 250;
const ETA_MIN_COMPLETED_UNITS = 3;
let etaSamples: EtaSample[] = [];
let etaSamplesForStartedAt: number | null = null;

function maybePushEtaSample(now: number, completed: number): void {
    if (etaSamplesForStartedAt !== importStartedAt) {
        etaSamples = [];
        etaSamplesForStartedAt = importStartedAt;
    }
    if (importStartedAt === null) return;
    const last = etaSamples.length > 0 ? etaSamples[etaSamples.length - 1] : null;
    if (last !== null && now - last.t < ETA_SAMPLE_INTERVAL_MS) return;
    etaSamples.push({ t: now, completed });
    while (etaSamples.length > 0 && etaSamples[0].t < now - ETA_WINDOW_MS) {
        etaSamples.shift();
    }
}

/**
 * Estimated remaining seconds for the in-flight import, or null if no
 * meaningful estimate is available yet. Uses a windowed rate when at
 * least `ETA_MIN_WINDOW_MS` of samples are buffered, falling back to
 * total-elapsed extrapolation before then.
 */
export function getImportEtaSeconds(): number | null {
    const p = importProgress;
    if (p === null || importStartedAt === null) return null;
    if (p.estimatedTotal <= 0) return null;
    const completed = Math.min(p.estimatedCompleted, p.estimatedTotal);
    const remainingUnits = Math.max(0, p.estimatedTotal - completed);
    if (remainingUnits <= 0) return 0;
    const now = Date.now();
    maybePushEtaSample(now, completed);
    let windowRemaining: number | null = null;
    const oldest = etaSamples.length > 0 ? etaSamples[0] : null;
    const windowAge = oldest !== null ? now - oldest.t : 0;
    if (
        oldest !== null &&
        windowAge >= ETA_MIN_WINDOW_MS &&
        completed - oldest.completed >= ETA_MIN_COMPLETED_UNITS
    ) {
        const msPerUnit = windowAge / (completed - oldest.completed);
        windowRemaining = (remainingUnits * msPerUnit) / 1000;
    } else {
        const elapsed = (now - importStartedAt) / 1000;
        if (completed >= ETA_MIN_COMPLETED_UNITS) {
            windowRemaining = (remainingUnits * elapsed) / completed;
        }
    }
    const calibrated = calibratedMsPerUnit();
    if (calibrated !== null && (p.etaConfidence === "planned" || windowRemaining === null)) {
        const remaining = (remainingUnits * calibrated) / 1000;
        return !isFinite(remaining) || remaining < 0 ? null : remaining;
    }
    const remaining = windowRemaining;
    if (remaining === null) return null;
    if (!isFinite(remaining) || remaining < 0) return null;
    return remaining;
}

export function getImportJsonPath(): string {
    return importJsonPath;
}
export function setImportJsonPath(path: string): void {
    importJsonPath = normalizeHtswPath(path);
}

export function getParsedResult(): ParseResult<Importable[]> | null {
    return parsedResult;
}
export function setParsedResult(r: ParseResult<Importable[]> | null): void {
    parsedResult = r;
}

export function getParseError(): string | null {
    return parseError;
}
export function setParseError(msg: string | null): void {
    parseError = msg;
}

export function getSelectedImportableId(): string | null {
    return selectedImportableId;
}
export function setSelectedImportableId(id: string | null): void {
    selectedImportableId = id;
}

export function getSelectedImportableIds(): Set<string> {
    return selectedImportableIds;
}
export function isImportableChecked(id: string): boolean {
    return selectedImportableIds.has(id);
}
export function toggleImportableChecked(id: string): void {
    if (selectedImportableIds.has(id)) selectedImportableIds.delete(id);
    else selectedImportableIds.add(id);
}
export function clearImportableSelection(): void {
    selectedImportableIds = new Set();
}

export function getOpenTabs(): SourceTab[] {
    return openTabs;
}
export function getActiveTabPath(): string | null {
    return activeTabPath;
}
export function openTab(tab: SourceTab): void {
    for (let i = 0; i < openTabs.length; i++) {
        if (openTabs[i].path === tab.path) {
            activeTabPath = tab.path;
            return;
        }
    }
    openTabs = openTabs.concat([tab]);
    activeTabPath = tab.path;
}
export function closeTab(path: string): void {
    const next: SourceTab[] = [];
    for (let i = 0; i < openTabs.length; i++) {
        if (openTabs[i].path !== path) next.push(openTabs[i]);
    }
    openTabs = next;
    if (activeTabPath === path) {
        activeTabPath = next.length > 0 ? next[next.length - 1].path : null;
    }
}
export function setActiveStateTab(path: string): void {
    activeTabPath = path;
}

export function getTrustMode(): boolean {
    return trustMode;
}
export function setTrustMode(v: boolean): void {
    trustMode = v;
}

export function getHousingUuid(): string | null {
    return housingUuid;
}
export function setHousingUuid(uuid: string | null): void {
    housingUuid = uuid;
}

export function getKnowledgeRows(): KnowledgeStatusRow[] {
    return knowledgeRows;
}
export function setKnowledgeRows(rows: KnowledgeStatusRow[]): void {
    knowledgeRows = rows;
}

export function getImportProgress(): ImportProgressView | null {
    return importProgress;
}
export function setImportProgress(p: ImportProgressView | null): void {
    if (p !== null && importProgress === null) {
        importStartedAt = Date.now();
        lastEstimatedCompleted = Math.max(0, p.estimatedCompleted);
        lastEstimatedTotal = Math.max(1, p.estimatedTotal);
    } else if (p === null) {
        importStartedAt = null;
        lastEstimatedCompleted = 0;
        lastEstimatedTotal = 1;
    }
    importProgress = p;
}
export function getImportStartedAt(): number | null {
    return importStartedAt;
}

export function getCurrentImportingPath(): string | null {
    return currentImportingPath;
}
export function setCurrentImportingPath(p: string | null): void {
    currentImportingPath = p;
}

export function beginImportRun(importables: readonly Importable[]): void {
    const rows = new Map<string, ImportRunRow>();
    const order: string[] = [];
    for (let i = 0; i < importables.length; i++) {
        const imp = importables[i];
        const identity = importableIdentity(imp);
        const key = trustPlanKey(imp.type, identity);
        order.push(key);
        rows.set(key, {
            key,
            type: imp.type,
            identity,
            order: i,
            status: "queued",
            phase: "starting",
            phaseLabel: "queued",
            unitCompleted: 0,
            unitTotal: 0,
        });
    }
    importRunState = { rows, order, startedAt: Date.now() };
}

export function getImportRunState(): ImportRunState | null {
    return importRunState;
}

export function getImportRunRow(key: string): ImportRunRow | null {
    if (importRunState === null) return null;
    return importRunState.rows.get(key) ?? null;
}

export function markImportRunRowDone(
    key: string,
    status: "imported" | "skipped" | "failed"
): void {
    if (importRunState === null) return;
    const row = importRunState.rows.get(key);
    if (row === undefined) return;
    importRunState.rows.set(key, { ...row, status });
}

export function updateImportRunFromProgress(progress: ImportProgress): void {
    if (importRunState === null || progress.currentKey.length === 0) return;
    const row = importRunState.rows.get(progress.currentKey);
    if (row === undefined || progress.rowStatus === null) return;
    if (progress.rowStatus === "current") {
        for (const key of importRunState.order) {
            if (key === progress.currentKey) continue;
            const other = importRunState.rows.get(key);
            if (other !== undefined && other.status === "current") {
                importRunState.rows.set(key, { ...other, status: "imported" });
            }
        }
    }
    importRunState.rows.set(progress.currentKey, {
        ...row,
        status: progress.rowStatus,
        phase: progress.phase,
        phaseLabel: progress.phaseLabel,
        unitCompleted: progress.unitCompleted,
        unitTotal: progress.unitTotal,
    });
}

export function clearImportRun(): void {
    importRunState = null;
}

export function applyImportProgress(p: ImportProgress): void {
    const rawCompleted = p.estimatedCompleted;
    const rawTotal = Math.max(1, p.estimatedTotal);
    const estimatedCompleted = Math.max(lastEstimatedCompleted, rawCompleted);
    const estimatedTotal = Math.max(lastEstimatedTotal, rawTotal, estimatedCompleted);
    lastEstimatedCompleted = estimatedCompleted;
    lastEstimatedTotal = estimatedTotal;
    importProgress = {
        weightCompleted: p.weightCompleted,
        weightTotal: p.weightTotal,
        weightCurrent: p.weightCurrent,
        currentKey: p.currentKey,
        currentType: p.currentType,
        currentIdentity: p.currentIdentity,
        orderIndex: p.orderIndex,
        rowStatus: p.rowStatus,
        currentLabel: p.currentLabel,
        phase: p.phase,
        phaseLabel: p.phaseLabel,
        unitCompleted: p.unitCompleted,
        unitTotal: p.unitTotal,
        estimatedCompleted,
        estimatedTotal,
        etaConfidence: p.etaConfidence,
        completed: p.completed,
        total: p.total,
        failed: p.failed,
        inFlight: p.completed < p.total,
    };
}
