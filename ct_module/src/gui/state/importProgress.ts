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

import type { ImportProgress, ImportProgressRow } from "../../importer/progress/types";
import { importProgressKey } from "../../importer/progress/keys";
import {
    getCurrentPhaseEtaSecondsCached as etaGetCurrentPhaseEtaSeconds,
    getImportEtaSeconds as etaGetImportEtaSeconds,
    resetEtaCache,
} from "../../importer/progress/eta";
import { importableIdentity } from "../../importCache/paths";
import type { QueueItem } from "./queue";
import { canonicalPath } from "./parses";
import { onImportRunningChanged } from "./selection";

let importProgress: ImportProgress | null = null;
/**
 * `Date.now()` of the moment the in-flight import started. Captured the
 * first time `setImportProgress` transitions from null to non-null and
 * cleared on the inverse transition.
 */
let importStartedAt: number | null = null;
/**
 * Resolved filesystem path of the importable currently being processed
 * by the in-flight import session. Drives the LiveImporter panel above
 * the inventory: when set, that file's HTSL is rendered with diff
 * colors; when null, the panel shows an idle state. Cleared by the
 * import's progress callback when the session reports no current
 * importable.
 */
let currentImportingPath: string | null = null;

export function getImportProgress(): ImportProgress | null {
    return importProgress;
}

export function getImportProgressFraction(): number {
    const p = importProgress;
    if (p === null || p.totalUnits <= 0) return 0;
    return Math.min(1, Math.max(0, p.completedUnits / p.totalUnits));
}

export function getImportEtaSeconds(): number | null {
    if (importStartedAt === null) return null;
    return etaGetImportEtaSeconds(importProgress, importStartedAt);
}

export function getCurrentPhaseEtaSeconds(): number | null {
    return etaGetCurrentPhaseEtaSeconds(importProgress, importStartedAt);
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

export function createImportRows(
    importables: readonly Importable[],
    sourcePath: string
): ImportProgressRow[] {
    const rows: ImportProgressRow[] = [];
    for (let i = 0; i < importables.length; i++) {
        const importable = importables[i];
        const identity = importableIdentity(importable);
        rows.push({
            key: importProgressKey(importable.type, identity, sourcePath),
            status: "queued",
            units: 1,
        });
    }
    return rows;
}

export function createImportProgress(init: Partial<ImportProgress>): ImportProgress {
    return normalizeImportProgress({
        completedImportables: init.completedImportables ?? 0,
        totalImportables: init.totalImportables ?? 1,
        completedUnits: init.completedUnits ?? 0,
        totalUnits: init.totalUnits ?? 1,
        current: init.current ?? null,
        rows: init.rows ?? [],
        failed: init.failed ?? 0,
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
    const prevPhase = importProgress?.current?.phase ?? null;
    const prevKey = importProgress?.current?.key ?? null;
    if (p !== null && importProgress === null) {
        importStartedAt = Date.now();
    } else if (p === null) {
        importStartedAt = null;
    }
    importProgress = p === null ? null : normalizeImportProgress(p);
    const nextPhase = p?.current?.phase ?? null;
    const nextKey = p?.current?.key ?? null;
    if (wasNull || p === null || prevPhase !== nextPhase || prevKey !== nextKey) {
        resetEtaCache();
    }
    onImportRunningChanged(!wasNull, p !== null);
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
          readFraction: number;
          hydrateFraction: number;
          applyFraction: number;
          /** Relative widths of the three phases (sum = 1). */
          readWidth: number;
          hydrateWidth: number;
          applyWidth: number;
      };

export function getQueueItemRunState(item: QueueItem): QueueItemRunState {
    if (importProgress === null) {
        return { kind: "queued" };
    }
    if (item.kind !== "importable") {
        // importJson rows aren't tracked individually; treat as queued.
        return { kind: "queued" };
    }
    const key = importProgressKey(item.type, item.identity, item.sourcePath);
    let row: ImportProgressRow | undefined;
    for (let i = 0; i < importProgress.rows.length; i++) {
        if (importProgress.rows[i].key === key) {
            row = importProgress.rows[i];
            break;
        }
    }
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
    const current = importProgress.current;
    if (current === null || current.key !== key) {
        return {
            kind: "current",
            readFraction: 0,
            hydrateFraction: 0,
            applyFraction: 0,
            readWidth: 0.33,
            hydrateWidth: 0.33,
            applyWidth: 0.34,
        };
    }
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
    return {
        kind: "current",
        readFraction: units.reading > 0 ? readDone / units.reading : 1,
        hydrateFraction: units.hydrating > 0 ? hydrateDone / units.hydrating : 1,
        applyFraction: units.applying > 0 ? applyDone / units.applying : 0,
        readWidth: units.reading / total,
        hydrateWidth: units.hydrating / total,
        applyWidth: units.applying / total,
    };
}

/**
 * True iff this queue item corresponds to the importable currently being
 * processed by the in-flight import session.
 */
export function isCurrentQueueItem(item: QueueItem): boolean {
    if (importProgress === null) return false;
    const current = importProgress.current;
    if (current === null) return false;
    if (item.kind === "importable") {
        return current.key === importProgressKey(
            item.type,
            item.identity,
            item.sourcePath
        );
    }
    if (currentImportingPath === null) return false;
    return canonicalPath(item.sourcePath) === canonicalPath(currentImportingPath);
}
