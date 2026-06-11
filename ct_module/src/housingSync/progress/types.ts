import type { Importable } from "htsw/types";

export type ProgressPhase = "setup" | "reading" | "hydrating" | "applying";

export type PhaseUnits = {
    setup: number;
    reading: number;
    hydrating: number;
    applying: number;
};

type ImportRunRowStatus =
    | "queued"
    | "current"
    | "imported"
    | "skipped"
    | "failed";

type SyncProgress = {
    completedUnits: number;
    totalUnits: number;
    parent: {
        completedUnits: number;
        totalUnits: number;
    } | null;
};

export type ProgressPayload = {
    phase: ProgressPhase;
    completedUnits: number;
    totalUnits: number;
    phaseUnits: PhaseUnits;
    sync: SyncProgress;
};

export type ImportableEntry = {
    key: string;
    status: ImportRunRowStatus;
    totalUnits: number;
};

export type ImportProgressActive = {
    key: string;
    type: Importable["type"];
    identity: string;
    phase: ProgressPhase | "done";
    completedUnits: number;
    totalUnits: number;
    phaseUnits: PhaseUnits;
    sync: SyncProgress | null;
};

export type ImportProgress = {
    completedUnits: number;
    totalUnits: number;
    /**
     * Set when an importable failed (the run halts on first failure). Carries
     * the failed importable's key and the Diagnostic message, for the GUI
     * failure banner. Null while the run is healthy.
     */
    failure?: { key: string; message: string } | null;
    active: ImportProgressActive | null;
    /**
     * Per-key snapshots of importables that completed pass-1 (read +
     * hydrate) but haven't reached pass-2 (apply). The queue mini bar
     * uses these to keep showing pass-1 progress on rows the active
     * cursor has moved past.
     */
    parked: { [key: string]: ImportProgressActive };
    rows: readonly ImportableEntry[];
};

/**
 * True when the running total is locked — no future event can widen it.
 *
 * Setup/reading/hydrating phases can still discover work (longer lists
 * than predicted, deeper nested bodies, more pages), so the total may
 * grow mid-run. The applying phase runs against a computed diff with a
 * fixed op count: the total is known, and the bar/ETA can be displayed
 * as exact rather than approximate.
 */
export function isImportTotalLocked(progress: ImportProgress): boolean {
    if (progress.active === null) return true;
    return progress.active.phase === "applying" || progress.active.phase === "done";
}

export function countImportablesByStatus(
    progress: ImportProgress
): { completed: number; failed: number; total: number } {
    let completed = 0;
    let failed = 0;
    for (let i = 0; i < progress.rows.length; i++) {
        const s = progress.rows[i].status;
        if (s === "imported" || s === "skipped") completed++;
        else if (s === "failed") failed++;
    }
    return { completed, failed, total: progress.rows.length };
}

/** Callback shape that action-list read/apply phases invoke. */
export type ProgressHandler = (progress: ProgressPayload) => void;

/**
 * Callback an export batch invokes to drive the shared progress UI. The batch
 * loops depend only on this interface; the GUI-driving implementation
 * (`createExportProgressSink`) lives under `gui/right-panel/import-tab/` and is
 * injected by the caller, so `importables/` stays GUI-agnostic.
 */
export type ExportProgressSink = {
    /** Called once the full list of names to export is known. */
    start(names: readonly string[]): void;
    /** Called as item `index` (0-based) begins exporting. */
    item(index: number, name: string): void;
    /**
     * Within-item read progress for item `index`, forwarded from the
     * action-list read's `ProgressHandler`. Optional — exporters that don't
     * thread it just get item-boundary granularity.
     */
    itemProgress?(index: number, payload: ProgressPayload): void;
    /**
     * Marks item `index` failed. Without this the sink's only "item ended"
     * signal is the next `item()` call, which reads as success — so callers
     * that swallow per-item errors and continue MUST report failures here.
     */
    itemFailed?(index: number, error: string): void;
    /** Called once when the batch finishes (success, failure, or cancel). */
    done(): void;
};
