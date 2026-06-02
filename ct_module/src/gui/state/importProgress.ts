/// <reference types="../../../CTAutocomplete" />

/**
 * Import-session progress state. Owns the `ImportProgress` object that the
 * importer mutates, plus derived queue-row render state and a few helpers
 * for building fresh progress shapes.
 *
 * Read by: the right-panel live importer panel, queue rows, code-view
 * focus tracking. Written by: `import-actions.ts:startImport` (via
 * `setImportProgress`) and the per-import preview event handler.
 */

import type { Importable } from "htsw/types";

import type { ImportProgress, ImportableEntry } from "../../importer/progress/types";
import { importProgressKey } from "../../importer/progress/keys";
import {
    createEtaCalculator,
    currentMsPerUnit,
    type EtaCalculator,
} from "../../importer/progress/eta";
import { setProgressTraceSampler } from "../../importer/progress/trace";
import { resetSessionTiming } from "../../importer/progress/timing";
import { importableIdentity } from "../../importCache/paths";
import type { QueueItem } from "./queue";
import { canonicalPath } from "./parses";
import { onImportRunningChanged } from "./selection";

// Feed the progress trace's periodic sampler the *displayed* ETA values, so
// `/htsw eta trace` captures what the user sees between events (the smoothing
// behavior in the gaps), not just the per-event candidate.
setProgressTraceSampler(() => {
    if (importProgress === null) return null;
    return {
        etaSec: getImportEtaSeconds(),
        phaseEtaSec: getCurrentPhaseEtaSeconds(),
        msPerUnit: currentMsPerUnit(),
        remaining: Math.max(0, importProgress.totalUnits - importProgress.completedUnits),
        completed: importProgress.completedUnits,
        total: importProgress.totalUnits,
    };
});

let importProgress: ImportProgress | null = null;
/**
 * The last final import progress, kept after `importProgress` is cleared
 * so the queue can still render done/skipped/failed states for a short
 * window after the import completes (the queue items stay visible briefly
 * for confirmation before being cleared).
 */
let lastFinishedProgress: ImportProgress | null = null;
/**
 * `Date.now()` of the moment the in-flight import started. Captured the
 * first time `setImportProgress` transitions from null to non-null and
 * cleared on the inverse transition.
 */
let importStartedAt: number | null = null;
/** Fresh per import session — cleared when `importProgress` returns to null. */
let etaCalc: EtaCalculator | null = null;
/**
 * Resolved filesystem path of the importable currently being processed
 * by the in-flight import session. Drives the LiveImporter panel above
 * the inventory: when set, that file's HTSL is rendered with diff
 * colors; when null, the panel shows an idle state. Cleared by the
 * import's progress callback when the session reports no current
 * importable.
 */
let activeImportPath: string | null = null;

export function getImportProgress(): ImportProgress | null {
    return importProgress;
}

/**
 * Whether the active progress session is an import or an export. The
 * progress strip + queue summary share one UI; this only swaps the
 * user-facing verb so an export run doesn't read "Importable N of M".
 */
let sessionVerb: "import" | "export" = "import";
export function getSessionVerb(): "import" | "export" {
    return sessionVerb;
}
export function setSessionVerb(v: "import" | "export"): void {
    sessionVerb = v;
}

/** Display name of the importable currently being processed, or null when idle. */
export function getActiveImportLabel(): string | null {
    if (importProgress === null || importProgress.active === null) return null;
    return importProgress.active.identity;
}

export function getImportProgressFraction(): number {
    const p = importProgress;
    if (p === null || p.totalUnits <= 0) return 0;
    return Math.min(1, Math.max(0, p.completedUnits / p.totalUnits));
}

export function getImportEtaSeconds(): number | null {
    return etaCalc === null ? null : etaCalc.getTotal(importProgress, importStartedAt);
}

export function getCurrentPhaseEtaSeconds(): number | null {
    return etaCalc === null ? null : etaCalc.getPhase(importProgress, importStartedAt);
}

export function getImportEtcMs(): number | null {
    const secs = getImportEtaSeconds();
    if (secs === null) return null;
    return Date.now() + Math.max(0, Math.round(secs * 1000));
}

export function getImportMsPerUnit(): number {
    return currentMsPerUnit();
}

export function getImportStartedAt(): number | null {
    return importStartedAt;
}

export function getImportElapsedMs(): number | null {
    return importStartedAt === null ? null : Date.now() - importStartedAt;
}

export function getActiveImportPath(): string | null {
    return activeImportPath;
}
export function setActiveImportPath(p: string | null): void {
    activeImportPath = p;
}

export function createImportRows(
    importables: readonly Importable[],
    sourcePath: string
): ImportableEntry[] {
    const rows: ImportableEntry[] = [];
    for (let i = 0; i < importables.length; i++) {
        const importable = importables[i];
        const identity = importableIdentity(importable);
        rows.push({
            key: importProgressKey(importable.type, identity, sourcePath),
            status: "queued",
            totalUnits: 1,
        });
    }
    return rows;
}

export function createImportProgress(init: Partial<ImportProgress>): ImportProgress {
    return normalizeImportProgress({
        completedUnits: init.completedUnits ?? 0,
        totalUnits: init.totalUnits ?? 1,
        active: init.active ?? null,
        parked: init.parked ?? {},
        rows: init.rows ?? [],
    });
}

function normalizeImportProgress(p: ImportProgress): ImportProgress {
    const completedUnits = Math.max(0, p.completedUnits);
    const totalUnits = Math.max(1, p.totalUnits, completedUnits);
    return {
        ...p,
        completedUnits,
        totalUnits,
    };
}

export function setImportProgress(p: ImportProgress | null): void {
    const wasNull = importProgress === null;
    if (p !== null && importProgress === null) {
        importStartedAt = Date.now();
        etaCalc = createEtaCalculator();
        resetSessionTiming();
        lastFinishedProgress = null;
    } else if (p === null) {
        lastFinishedProgress = importProgress;
        importStartedAt = null;
        etaCalc = null;
        sessionVerb = "import";
    }
    importProgress = p === null ? null : normalizeImportProgress(p);
    onImportRunningChanged(!wasNull, p !== null);
}

export function clearLastFinishedProgress(): void {
    lastFinishedProgress = null;
}

/**
 * Render-state for a queue row's mini progress bar. "queued" → empty bar;
 * "done" → full green; "failed" → full red; "current" → phase-segmented
 * showing how far through each phase we are within this importable.
 */
type QueuePhase = "reading" | "hydrating" | "applying";

export type QueueItemRunState =
    | { kind: "queued" }
    | { kind: "done" }
    | { kind: "skipped" }
    | { kind: "failed" }
    | {
          kind: "current";
          phase: QueuePhase;
          /** 0..1 within the current phase. Resets to 0 when the phase advances. */
          phaseFraction: number;
      }
    | {
          kind: "parked";
          phase: QueuePhase;
          phaseFraction: number;
      };

export function getQueueItemRunState(item: QueueItem): QueueItemRunState {
    const progress = importProgress ?? lastFinishedProgress;
    if (progress === null) {
        return { kind: "queued" };
    }
    if (item.kind !== "importable") {
        // importJson rows aren't tracked individually; treat as queued.
        return { kind: "queued" };
    }
    const key = importProgressKey(item.type, item.identity, item.sourcePath);
    let row: ImportableEntry | undefined;
    for (let i = 0; i < progress.rows.length; i++) {
        if (progress.rows[i].key === key) {
            row = progress.rows[i];
            break;
        }
    }
    if (row === undefined) return { kind: "queued" };
    if (row.status === "imported") return { kind: "done" };
    if (row.status === "skipped") return { kind: "skipped" };
    if (row.status === "failed") {
        // The session halts on first failure, so everything after this
        // stays queued. We render the failed row with the error color
        // (distinct from the green "done" fill) so the user can see at a
        // glance which importable aborted the run.
        return { kind: "failed" };
    }
    if (row.status === "queued") return { kind: "queued" };
    const current = progress.active;
    if (current === null || current.key !== key) {
        const parked = progress.parked[key];
        if (parked !== undefined) {
            const snap = runStateFromActive(parked);
            return { kind: "parked", phase: snap.phase, phaseFraction: snap.phaseFraction };
        }
        return {
            kind: "parked",
            phase: "reading",
            phaseFraction: 0,
        };
    }
    return runStateFromActive(current);
}

function runStateFromActive(active: {
    phase: "setup" | "reading" | "hydrating" | "applying" | "done";
    completedUnits: number;
    phaseUnits: { setup: number; reading: number; hydrating: number; applying: number };
}): Extract<QueueItemRunState, { kind: "current" }> {
    const units = active.phaseUnits;
    const readingUnits = units.setup + units.reading;
    const within = Math.max(0, active.completedUnits);
    const readingDone = Math.min(readingUnits, within);
    const hydrateDone = Math.min(
        units.hydrating,
        Math.max(0, within - readingUnits)
    );
    const applyDone = Math.min(
        units.applying,
        Math.max(0, within - readingUnits - units.hydrating)
    );
    let phase: QueuePhase;
    let phaseFraction: number;
    if (active.phase === "applying") {
        phase = "applying";
        phaseFraction = units.applying > 0 ? applyDone / units.applying : 0;
    } else if (active.phase === "hydrating") {
        phase = "hydrating";
        phaseFraction = units.hydrating > 0 ? hydrateDone / units.hydrating : 1;
    } else {
        phase = "reading";
        phaseFraction = readingUnits > 0 ? readingDone / readingUnits : 1;
    }
    return {
        kind: "current",
        phase,
        phaseFraction,
    };
}

/**
 * True iff this queue item corresponds to the importable currently being
 * processed by the in-flight import session.
 */
export function isCurrentQueueItem(item: QueueItem): boolean {
    if (importProgress === null) return false;
    const current = importProgress.active;
    if (current === null) return false;
    if (item.kind === "importable") {
        return current.key === importProgressKey(
            item.type,
            item.identity,
            item.sourcePath
        );
    }
    if (activeImportPath === null) return false;
    return canonicalPath(item.sourcePath) === canonicalPath(activeImportPath);
}
