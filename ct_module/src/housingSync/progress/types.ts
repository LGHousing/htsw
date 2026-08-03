import type { Importable } from "htsw/types";
import type { SyncEventHandler } from "../syncEvents";

export type ProgressPhase = "setup" | "reading" | "hydrating" | "applying";

export type PhaseUnits = {
    setup: number;
    reading: number;
    hydrating: number;
    applying: number;
};

type TaskRunRowStatus = "queued" | "current" | "imported" | "skipped" | "failed";

type ListSyncProgress = {
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
    sync: ListSyncProgress;
    preserveApplyingEstimate?: boolean;
    measuredTotalUnits?: true;
};

export type TaskProgressEntry = {
    key: string;
    status: TaskRunRowStatus;
    totalUnits: number;
};

/**
 * The grid slot a MENU import is writing right now, with its item's display
 * name, for the live panel. Null for non-menu importables and while the menu
 * is not being updated.
 */
export type MenuSlotFocus = {
    slot: number;
    label: string | null;
    index: number;
    count: number;
};

export type KnowledgeSourceKind = "cache" | "house" | "known";

export type KnowledgeSourceReason =
    | "whole-importable"
    | "cached-list"
    | "shell-read"
    | "full-read"
    | "lock-verification"
    | "lock-verified"
    | "cache-missing"
    | "lock-conflict"
    | "known-empty";

export type KnowledgeLockStatus = "matched" | "missing" | "mismatch";

export type ImportKnowledgeState = {
    usedCache: boolean;
    currentSource: KnowledgeSourceKind;
    currentReason: KnowledgeSourceReason;
    lockStatus: KnowledgeLockStatus | null;
};

export type TaskProgressActive = {
    key: string;
    type: Importable["type"];
    identity: string;
    phase: ProgressPhase | "done";
    completedUnits: number;
    totalUnits: number;
    phaseUnits: PhaseUnits;
    sync: ListSyncProgress | null;
    currentSlot?: MenuSlotFocus | null;
    knowledge?: ImportKnowledgeState | null;
    scanCompleted: boolean;
    hydrationRequired: boolean;
};

export type TaskProgress = {
    completedUnits: number;
    totalUnits: number;
    totalsLocked: boolean;
    /**
     * Set when an importable failed (the run halts on first failure). Carries
     * the failed importable's key and the Diagnostic message, for the GUI
     * failure banner. Null while the run is healthy.
     */
    failure?: { key: string; message: string } | null;
    active: TaskProgressActive | null;
    /**
     * Per-key snapshots of importables whose reading and hydration are
     * complete but which have not begun applying. The queue mini bar keeps
     * showing their observed progress after the active cursor moves on.
     */
    parked: { [key: string]: TaskProgressActive };
    rows: readonly TaskProgressEntry[];
};

/**
 * True when the session has begun applying, or when the active importable is
 * already in a phase whose total cannot widen.
 *
 * Setup/reading/hydrating phases can still discover work (longer lists
 * than predicted, deeper child bodies, more pages), so the total may
 * grow mid-run. Staged imports lock the whole session after planning;
 * other flows retain the active-phase behavior.
 */
export function isTaskTotalLocked(progress: TaskProgress): boolean {
    if (progress.totalsLocked) return true;
    if (progress.active === null) return true;
    return progress.active.phase === "applying" || progress.active.phase === "done";
}

export function countTaskRowsByStatus(progress: TaskProgress): {
    completed: number;
    failed: number;
    total: number;
} {
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
 * loops depend only on this interface; the GUI-driving implementation is
 * injected by the caller, so `importables/` stays GUI-agnostic.
 */
export type ExportProgressSink = {
    /** Receives the reader's shallow and hydrated action snapshots for the live code view. */
    events?: SyncEventHandler;
    /** Scopes sibling action lists that each number their actions from zero. */
    eventsForList?: (label: string) => SyncEventHandler;
    /** Called once the full list of names to export is known. */
    start(names: readonly string[]): void;
    scanStarted?(): void;
    /** Called as item `index` (0-based) begins exporting. */
    item(index: number, name: string): void;
    itemReactivated?(index: number): void;
    /**
     * Called after item `index` completes successfully: after a direct read or
     * staged hydration, never after only the scan.
     */
    itemFinished?(index: number): void;
    /**
     * Within-item read progress for item `index`, forwarded from the
     * action-list read's `ProgressHandler`. Optional — exporters that don't
     * thread it just get item-boundary granularity.
     */
    itemProgress?(index: number, payload: ProgressPayload): void;
    /**
     * Marks item `index` failed. Callers that swallow per-item errors and
     * continue must report failures here instead of calling `itemFinished`.
     */
    itemFailed?(index: number, error: string): void;
    /** Called once when the batch finishes (success, failure, or cancel). */
    done(): void;
};
