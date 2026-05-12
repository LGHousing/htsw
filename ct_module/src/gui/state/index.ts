/// <reference types="../../../CTAutocomplete" />

import type { ParseResult } from "htsw";
import type { Importable } from "htsw/types";

import type { KnowledgeStatusRow } from "../../knowledge/status";
import type {
    ImportProgress,
    ImportRunRowStatus,
} from "../../importables/importSession";
import { normalizeHtswPath } from "../lib/pathDisplay";
import { getPhaseStats } from "../../importer/progress/timing";
import type { ActionListPhaseBudget } from "../../importer/progress/costs";
import { importableIdentity } from "../../knowledge/paths";
import { trustPlanKey } from "../../knowledge/trust";
import type { QueueItem } from "./queue";
import { canonicalPath } from "./parses";
import { getActiveRightTab, setActiveRightTab } from "./selection";

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
    /** Per-phase budget for the in-flight action-list call. Null when not
     *  inside one (e.g. between importables, during knowledge writes). */
    phaseBudget: ActionListPhaseBudget | null;
    /** Per-importable initial weights (indexed by orderIndex) for divider
     *  tick marks on the overall bar. */
    weights: readonly number[];
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
let openTabs: SourceTab[] = [];
let activeTabPath: string | null = null;
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
let importProgress: ImportProgressView | null = null;
let importRunState: ImportRunState | null = null;
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

/**
 * Baseline ms/budget-unit per phase. Used until real observed timing data
 * is collected. Numbers are from a measured `/htsw eta dump` against a
 * 10-importable session (~537 budget units, ~85s wall time):
 *   - reading: ~118 ms/u rounded to 120
 *   - hydrating: ~168 ms/u rounded to 170
 *   - applying: ~158 ms/u rounded to 160
 *
 * Diffing isn't tracked: it's pure in-process compute, ~1-5ms per call,
 * and contributes nothing meaningful to ETA.
 *
 * To re-validate / refresh these:
 *   1. `/htsw eta reset` — clear any prior samples
 *   2. Run a representative import
 *   3. `/htsw eta` to inspect, `/htsw eta dump` to snapshot to JSON
 *   4. Update these constants from the measured values
 *
 * Once `getPhaseStats()` has real data for a phase, the observed rate
 * replaces the default for that phase — defaults only fire on the very
 * first emit per phase per session.
 */
const DEFAULT_MS_PER_UNIT_BY_PHASE: {
    [k in "reading" | "hydrating" | "applying"]: number;
} = {
    reading: 120,
    hydrating: 170,
    applying: 160,
};

/** Generic fallback when callers ask outside the tracked phases. */
const DEFAULT_MS_PER_UNIT = 160;

function msPerUnitForPhase(phase: "reading" | "hydrating" | "applying"): number {
    const stats = getPhaseStats();
    const entry = stats[phase];
    if (entry === undefined || entry.totalBudgetUnits <= 0) {
        return DEFAULT_MS_PER_UNIT_BY_PHASE[phase];
    }
    return entry.msPerBudgetUnit;
}

/**
 * Cached ETA from the most recent progress event, decremented by elapsed
 * wall time on each read so the displayed countdown ticks down between
 * progress events instead of freezing. Recomputed fresh whenever a new
 * progress event arrives via `applyImportProgress`.
 */
let cachedEtaSeconds: number | null = null;
let cachedEtaComputedAt: number | null = null;

function recomputeEtaForCurrentProgress(): number | null {
    const p = importProgress;
    if (p === null) return null;

    // Within-importable phase breakdown using the live phaseBudget.
    let remainingMs = 0;
    if (p.phaseBudget !== null) {
        const pb = p.phaseBudget;
        const phaseOrder: Array<"reading" | "hydrating" | "applying"> = [
            "reading",
            "hydrating",
            "applying",
        ];
        // Cumulative budget consumed up to (not including) each phase.
        const phaseStartCum: { [k: string]: number } = {
            reading: 0,
            hydrating: pb.readPart,
            applying: pb.readPart + pb.hydratePart,
        };
        const phasePart: { [k: string]: number } = {
            reading: pb.readPart,
            hydrating: pb.hydratePart,
            applying: pb.applyPart,
        };
        // Position inside the current importable. estimatedCompleted in
        // the progress view is `weightCompleted + currentImportableProgress`,
        // so subtract weightCompleted to get the within-importable cursor.
        const within =
            p.estimatedCompleted - p.weightCompleted;
        const currentPhaseFromEvent: "reading" | "hydrating" | "applying" | null =
            p.phase === "reading" || p.phase === "hydrating" || p.phase === "applying"
                ? p.phase
                : null;
        for (const ph of phaseOrder) {
            const phStart = phaseStartCum[ph];
            const phLen = phasePart[ph];
            const phEnd = phStart + phLen;
            // Position WITHIN this phase: 0 if we haven't reached it yet,
            // phLen if we've passed it, else cursor - phStart.
            let consumedInPhase: number;
            if (currentPhaseFromEvent === ph) {
                consumedInPhase = Math.min(phLen, Math.max(0, within - phStart));
            } else if (within >= phEnd) {
                consumedInPhase = phLen;
            } else if (within < phStart) {
                consumedInPhase = 0;
            } else {
                // Cursor is mid-phase but the event reports a different
                // phase — trust the cursor (within - phStart, clamped).
                consumedInPhase = Math.min(phLen, Math.max(0, within - phStart));
            }
            const remainingInPhase = Math.max(0, phLen - consumedInPhase);
            if (remainingInPhase > 0) {
                remainingMs += remainingInPhase * msPerUnitForPhase(ph);
            }
        }
    } else {
        // No phase budget (e.g. non-action-list phases like
        // opening/writingKnowledge). Fall back to weight-based remaining
        // for the current importable using a generic ms/unit.
        const within = Math.max(0, p.weightCurrent - (p.estimatedCompleted - p.weightCompleted));
        remainingMs += within * DEFAULT_MS_PER_UNIT;
    }

    // Future importables (after the current one). Use estimateImportableCost
    // already baked into weightTotal: remainingFutureWeight = weightTotal -
    // weightCompleted - weightCurrent. We don't have per-phase breakdown for
    // future importables, so use a representative blended rate from the
    // applying phase (the dominant one for most action lists).
    const remainingFutureWeight = Math.max(
        0,
        p.weightTotal - p.weightCompleted - p.weightCurrent
    );
    if (remainingFutureWeight > 0) {
        remainingMs += remainingFutureWeight * msPerUnitForPhase("applying");
    }

    if (!isFinite(remainingMs) || remainingMs < 0) return null;
    return remainingMs / 1000;
}

/**
 * Estimated remaining seconds for the in-flight import. Phase-aware:
 * remaining work is decomposed by phase and each phase contributes via
 * its own observed ms/budget-unit, so a slow "reading" pass doesn't
 * poison the projection of an "applying" pass and vice versa.
 *
 * Ticks down between progress events: caches the most recent computed
 * value with its timestamp and returns `cached - elapsed` until a new
 * event triggers recomputation in `applyImportProgress`.
 */
export function getImportEtaSeconds(): number | null {
    if (importProgress === null || importStartedAt === null) return null;
    if (cachedEtaSeconds === null || cachedEtaComputedAt === null) {
        cachedEtaSeconds = recomputeEtaForCurrentProgress();
        cachedEtaComputedAt = Date.now();
        if (cachedEtaSeconds === null) return null;
    }
    const elapsed = (Date.now() - cachedEtaComputedAt) / 1000;
    const live = cachedEtaSeconds - elapsed;
    return live < 0 ? 0 : live;
}

/**
 * Remaining seconds for *just the current importable*, decoupled from the
 * queue-wide ETA. Sums per-phase remaining ms within the in-flight
 * importable using its live phaseBudget; falls back to weight-based
 * remaining for non-action-list phases (opening / writingKnowledge).
 */
export function getCurrentImportableEtaSeconds(): number | null {
    const p = importProgress;
    if (p === null) return null;
    const breakdown = getImportEtaBreakdown();
    if (breakdown === null) return null;
    const ms =
        breakdown.readSeconds +
        breakdown.hydrateSeconds +
        breakdown.applySeconds;
    return ms;
}

/**
 * Per-phase breakdown of the *current importable's* remaining work, plus
 * a separate bucket for everything-after-this-importable. Lets the UI
 * show the user where the projected time is going. Returns null if no
 * import is in flight.
 */
export type ImportEtaBreakdown = {
    readSeconds: number;
    hydrateSeconds: number;
    applySeconds: number;
    futureImportableSeconds: number;
    futureImportableCount: number;
};

export function getImportEtaBreakdown(): ImportEtaBreakdown | null {
    const p = importProgress;
    if (p === null) return null;
    let readMs = 0;
    let hydrateMs = 0;
    let applyMs = 0;
    if (p.phaseBudget !== null) {
        const pb = p.phaseBudget;
        const within = p.estimatedCompleted - p.weightCompleted;
        const phaseStartCum: { [k: string]: number } = {
            reading: 0,
            hydrating: pb.readPart,
            applying: pb.readPart + pb.hydratePart,
        };
        const remainingIn = (
            ph: "reading" | "hydrating" | "applying",
            phLen: number
        ): number => {
            const phStart = phaseStartCum[ph];
            const phEnd = phStart + phLen;
            if (within >= phEnd) return 0;
            if (within < phStart) return phLen;
            return Math.max(0, phEnd - within);
        };
        readMs = remainingIn("reading", pb.readPart) * msPerUnitForPhase("reading");
        hydrateMs =
            remainingIn("hydrating", pb.hydratePart) * msPerUnitForPhase("hydrating");
        applyMs = remainingIn("applying", pb.applyPart) * msPerUnitForPhase("applying");
    } else {
        // Pre-action-list phase (opening / starting). Treat all current
        // importable work as "applying" for breakdown display since we
        // can't decompose without a phase budget yet.
        const within = Math.max(
            0,
            p.weightCurrent - (p.estimatedCompleted - p.weightCompleted)
        );
        applyMs = within * msPerUnitForPhase("applying");
    }
    const futureWeight = Math.max(
        0,
        p.weightTotal - p.weightCompleted - p.weightCurrent
    );
    const futureMs = futureWeight * msPerUnitForPhase("applying");
    const futureCount = Math.max(0, p.total - p.completed - 1);
    return {
        readSeconds: readMs / 1000,
        hydrateSeconds: hydrateMs / 1000,
        applySeconds: applyMs / 1000,
        futureImportableSeconds: futureMs / 1000,
        futureImportableCount: futureCount,
    };
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

export function getImportProgress(): ImportProgressView | null {
    return importProgress;
}
export function setImportProgress(p: ImportProgressView | null): void {
    const wasNull = importProgress === null;
    if (p !== null && importProgress === null) {
        importStartedAt = Date.now();
    } else if (p === null) {
        importStartedAt = null;
        cachedEtaSeconds = null;
        cachedEtaComputedAt = null;
    }
    importProgress = p;
    // Force ETA recompute on the next read so the new event's data is used.
    cachedEtaSeconds = null;
    cachedEtaComputedAt = null;
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
 * "done" → full green; "current" → phase-segmented showing how far through
 * each phase we are within this importable.
 */
export type QueueItemRunState =
    | { kind: "queued" }
    | { kind: "done" }
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
        // Treat failed as "done" for bar purposes; the aborted-import
        // halt means everything after stays queued anyway.
        return { kind: "done" };
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
    const estimatedCompleted = Math.max(0, p.estimatedCompleted);
    const estimatedTotal = Math.max(1, p.estimatedTotal, estimatedCompleted);
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
        phaseBudget: p.phaseBudget,
        weights: p.weights,
        completed: p.completed,
        total: p.total,
        failed: p.failed,
        inFlight: p.completed < p.total,
    };
    // Fresh data — discard the cached/ticking ETA so the next read
    // recomputes against the new state.
    cachedEtaSeconds = null;
    cachedEtaComputedAt = null;
}
