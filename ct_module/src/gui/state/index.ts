/// <reference types="../../../CTAutocomplete" />

import type { ParseResult } from "htsw";
import type { Importable } from "htsw/types";

import type { KnowledgeStatusRow } from "../../knowledge/status";
import type {
    ImportProgress,
    ImportRunRowStatus,
} from "../../importer/progress/types";
import { normalizeHtswPath } from "../lib/pathDisplay";
import {
    getImportEtaBreakdown as etaGetImportEtaBreakdown,
    getImportEtaSeconds as etaGetImportEtaSeconds,
    resetEtaCache,
} from "../../importer/progress/eta";
import { importableIdentity } from "../../knowledge/paths";
import { trustPlanKey } from "../../knowledge/trust";
import type { QueueItem } from "./queue";
import { canonicalPath } from "./parses";
import { getActiveRightTab, setActiveRightTab } from "./selection";

type ImportRunRow = {
    key: string;
    type: Importable["type"];
    identity: string;
    order: number;
    status: ImportRunRowStatus;
    phase: ImportProgress["phase"];
    phaseLabel: string;
    unitCompleted: number;
    unitTotal: number;
};

type ImportRunState = {
    rows: Map<string, ImportRunRow>;
    order: string[];
    startedAt: number;
};

let importJsonPath = "./htsw/imports/import.json";
let exportImportJsonPath: string | null = null;
let parsedResult: ParseResult<Importable[]> | null = null;
/**
 * Multi-select for the Importables tab. Keyed by `${type}:${identity}`
 * (the `trustPlanKey` shape). Independent of `selectedImportableId` —
 * single-selection drives preview, multi-selection drives "Import
 * selected" and the queue-bulk paths.
 */
const checkedImportableKeys: Set<string> = new Set();
/**
 * Resolved filesystem path of the importable currently being processed by
 * the in-flight import session. Drives the LiveImporter panel above the
 * inventory: when set, that file's HTSL is rendered with diff colors;
 * when null, the panel shows an idle state. Cleared by the import's
 * progress callback when the session reports `currentLabel === "done"`.
 */
let currentImportingPath: string | null = null;
/** Housing UUIDs the user has explicitly opted in to "trust the cache for". */
const trustedHouses: Set<string> = new Set();
/**
 * When true, sound effects fired by `Forge.PlaySoundEvent` are cancelled
 * while an import is in flight. Suppresses the repetitive ding/click
 * sounds Hypixel plays on every housing menu open during an import.
 */
let muteImportSounds: boolean = false;
let housingUuid: string | null = null;
let knowledgeRows: KnowledgeStatusRow[] = [];
let importProgress: ImportProgress | null = null;
let importRunState: ImportRunState | null = null;
/**
 * `Date.now()` of the moment the in-flight import started. Captured the
 * first time `setImportProgress` transitions from null to non-null and
 * cleared on the inverse transition.
 */
let importStartedAt: number | null = null;
let importProgressUpdatedAt: number | null = null;

export function getImportProgressFraction(): number {
    const p = importProgress;
    if (p === null || p.estimatedTotal <= 0) return 0;
    return Math.min(1, Math.max(0, p.estimatedCompleted / p.estimatedTotal));
}

/**
 * Total remaining seconds for the in-flight import. Phase-aware, with
 * a guard that prevents the cached/decayed value from undershooting
 * the current importable's recomputed remaining. See
 * `importer/progress/eta.ts` for the math.
 */
export function getImportEtaSeconds(): number | null {
    if (importStartedAt === null) return null;
    return etaGetImportEtaSeconds(importProgress);
}
/** Remaining seconds for the active read/hydrate/apply phase. */
export function getCurrentPhaseEtaSeconds(): number | null {
    const p = importProgress;
    if (p === null) return null;
    const breakdown = etaGetImportEtaBreakdown(p);
    if (breakdown === null) return null;

    let secs: number | null = null;
    const phase = p.phase === "diffing" ? "applying" : p.phase;
    if (phase === "reading") secs = breakdown.readSeconds;
    else if (phase === "hydrating") secs = breakdown.hydrateSeconds;
    else if (phase === "applying") secs = breakdown.applySeconds;
    if (secs === null || importProgressUpdatedAt === null) return secs;
    return Math.max(0, secs - (Date.now() - importProgressUpdatedAt) / 1000);
}
export function getImportJsonPath(): string {
    return importJsonPath;
}
export function setImportJsonPath(path: string): void {
    importJsonPath = normalizeHtswPath(path);
}

export function getExportImportJsonPath(): string {
    return exportImportJsonPath === null ? importJsonPath : exportImportJsonPath;
}
export function setExportImportJsonPath(path: string): void {
    exportImportJsonPath = normalizeHtswPath(path);
}

export function getParsedResult(): ParseResult<Importable[]> | null {
    return parsedResult;
}
export function setParsedResult(r: ParseResult<Importable[]> | null): void {
    parsedResult = r;
}

export function setParseError(msg: string | null): void {
    void msg;
}

export function isImportableChecked(key: string): boolean {
    return checkedImportableKeys.has(key);
}
export function toggleImportableChecked(key: string): boolean {
    if (checkedImportableKeys.has(key)) {
        checkedImportableKeys.delete(key);
        return false;
    }
    checkedImportableKeys.add(key);
    return true;
}
export function clearImportableChecks(): void {
    checkedImportableKeys.clear();
}
export function getCheckedImportableKeys(): Set<string> {
    return checkedImportableKeys;
}
export function getCheckedImportableCount(): number {
    return checkedImportableKeys.size;
}

export function isHouseTrusted(uuid: string): boolean {
    return trustedHouses.has(uuid);
}
export function setHouseTrust(uuid: string, trusted: boolean): void {
    if (trusted) trustedHouses.add(uuid);
    else trustedHouses.delete(uuid);
}
/** Trust mode is now per-house: an in-flight import trusts the cache iff
 *  the current housing UUID is in the trusted-houses set. */
export function isCurrentHouseTrusted(): boolean {
    return housingUuid !== null && trustedHouses.has(housingUuid);
}

export function isImportSoundsMuted(): boolean {
    return muteImportSounds;
}
export function setImportSoundsMuted(muted: boolean): void {
    muteImportSounds = muted;
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

export function getImportProgress(): ImportProgress | null {
    return importProgress;
}
export type ImportProgressInit =
    & Pick<ImportProgress, "currentIdentity">
    & Partial<ImportProgress>;

export function createImportProgress(init: ImportProgressInit): ImportProgress {
    const unitTotal = init.unitTotal ?? 1;
    const estimatedTotal = init.estimatedTotal ?? Math.max(1, unitTotal);
    return normalizeImportProgress({
        weightCompleted: init.weightCompleted ?? 0,
        weightTotal: init.weightTotal ?? estimatedTotal,
        weightCurrent: init.weightCurrent ?? 0,
        currentKey: init.currentKey ?? "",
        currentType: init.currentType ?? null,
        currentIdentity: init.currentIdentity,
        orderIndex: init.orderIndex ?? -1,
        rowStatus: init.rowStatus ?? null,
        currentLabel: init.currentLabel ?? init.currentIdentity,
        phase: init.phase ?? "starting",
        phaseLabel: init.phaseLabel ?? init.currentLabel ?? init.currentIdentity,
        unitCompleted: init.unitCompleted ?? 0,
        unitTotal,
        estimatedCompleted: init.estimatedCompleted ?? 0,
        estimatedTotal,
        etaConfidence: init.etaConfidence ?? "rough",
        phaseBudget: init.phaseBudget ?? null,
        weights: init.weights ?? [],
        completed: init.completed ?? 0,
        total: init.total ?? 1,
        failed: init.failed ?? 0,
    });
}

function normalizeImportProgress(p: ImportProgress): ImportProgress {
    const estimatedCompleted = Math.max(0, p.estimatedCompleted);
    const estimatedTotal = Math.max(1, p.estimatedTotal, estimatedCompleted);
    return {
        ...p,
        estimatedCompleted,
        estimatedTotal,
    };
}

export function setImportProgress(p: ImportProgress | null): void {
    const wasNull = importProgress === null;
    if (p !== null && importProgress === null) {
        importStartedAt = Date.now();
    } else if (p === null) {
        importStartedAt = null;
        importProgressUpdatedAt = null;
    }
    importProgress = p === null ? null : normalizeImportProgress(p);
    if (p !== null) {
        importProgressUpdatedAt = Date.now();
    }
    // Force ETA recompute on the next read so the new event's data is used.
    resetEtaCache();
    // On import start, flip the right panel to the Import tab so the
    // user sees the live progress without having to click. On end,
    // flip back to View (where they were before the import) — but only
    // if we're still on Import, so we don't override an explicit user
    // navigation away mid-import.
    if (p !== null && wasNull) {
        setActiveRightTab("import");
    } else if (p === null && !wasNull && getActiveRightTab() === "import") {
        setActiveRightTab("view");
    }
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

/**
 * Render-state for a queue row's mini progress bar. "queued" → empty bar;
 * "done" → full green; "failed" → full red; "current" → phase-segmented
 * showing how far through each phase we are within this importable.
 */
export type QueueItemRunState =
    | { kind: "queued" }
    | { kind: "done" }
    | { kind: "failed" }
    | {
          kind: "current";
          /**
           * Per-phase fill, each in [0,1]. 0 = phase not started, 1 =
           * phase complete. Phases are weighted by their relative budget
           * so they take up proportional widths in the bar.
           */
          readFraction: number;
          hydrateFraction: number;
          applyFraction: number;
          /** Relative widths of the three phases (sum = 1). */
          readWeight: number;
          hydrateWeight: number;
          applyWeight: number;
      };

export function getQueueItemRunState(item: QueueItem): QueueItemRunState {
    const runState = importRunState;
    if (runState === null || importProgress === null) {
        return { kind: "queued" };
    }
    if (item.kind !== "importable") {
        // importJson rows aren't tracked individually; treat as queued.
        return { kind: "queued" };
    }
    const key = trustPlanKey(item.type, item.identity);
    const row = runState.rows.get(key);
    if (row === undefined) return { kind: "queued" };
    if (row.status === "imported" || row.status === "skipped") {
        return { kind: "done" };
    }
    if (row.status === "failed") {
        // The session halts on first failure, so everything after this
        // stays queued. We render the failed row with the error color
        // (distinct from the green "done" fill) so the user can see at a
        // glance which importable aborted the run.
        return { kind: "failed" };
    }
    if (row.status === "queued") return { kind: "queued" };
    // "current" — break down by phase using the live phaseBudget.
    const p = importProgress;
    if (p.phaseBudget === null) {
        // Pre-action-list phase (opening). Show empty bar — the row is
        // marked "current" by the stripe; we just don't fill yet.
        return {
            kind: "current",
            readFraction: 0,
            hydrateFraction: 0,
            applyFraction: 0,
            readWeight: 0.33,
            hydrateWeight: 0.33,
            applyWeight: 0.34,
        };
    }
    const pb = p.phaseBudget;
    const total = Math.max(1, pb.readPart + pb.hydratePart + pb.applyPart);
    const within = Math.max(0, p.estimatedCompleted - p.weightCompleted);
    const readDone = Math.min(pb.readPart, within);
    const hydrateDone = Math.min(
        pb.hydratePart,
        Math.max(0, within - pb.readPart)
    );
    const applyDone = Math.min(
        pb.applyPart,
        Math.max(0, within - pb.readPart - pb.hydratePart)
    );
    return {
        kind: "current",
        readFraction: pb.readPart > 0 ? readDone / pb.readPart : 1,
        hydrateFraction: pb.hydratePart > 0 ? hydrateDone / pb.hydratePart : 1,
        applyFraction: pb.applyPart > 0 ? applyDone / pb.applyPart : 0,
        readWeight: pb.readPart / total,
        hydrateWeight: pb.hydratePart / total,
        applyWeight: pb.applyPart / total,
    };
}

/**
 * True iff this queue item corresponds to the importable currently being
 * processed by the in-flight import session. For "importable" items we
 * match by `${type}:${identity}` (the trustPlanKey shape used as
 * `currentKey` in ImportProgress). For "importJson" items we match
 * whenever the current importable is sourced from that import.json file.
 */
export function isCurrentQueueItem(item: QueueItem): boolean {
    if (importProgress === null) return false;
    if (importProgress.currentKey.length === 0) return false;
    if (item.kind === "importable") {
        return importProgress.currentKey === trustPlanKey(item.type, item.identity);
    }
    // importJson: match by source file path against the current importable's
    // source file (the live diff sink uses currentImportingPath for this).
    if (currentImportingPath === null) return false;
    return canonicalPath(item.sourcePath) === canonicalPath(currentImportingPath);
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

