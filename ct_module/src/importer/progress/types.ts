import type { Importable } from "htsw/types";

import type { ActionListPhaseBudget, EtaConfidence } from "./costs";

/**
 * The shape of a single progress event flowing from the importer up to
 * the GUI. One record type, three logical scopes — readList/applyDiff
 * fill the action-list-scope fields; `importSession.emitProgress`
 * augments with importable + session-scope fields. The GUI stores this
 * exact shape; no intermediate translation.
 */
export type ImportRunRowStatus =
    | "queued"
    | "current"
    | "imported"
    | "skipped"
    | "failed";

/** All phases an import can be in, end-to-end. */
type ImportPhase =
    | "starting"
    | "reading"
    | "hydrating"
    | "diffing"
    | "applying"
    | "writingKnowledge"
    | "done";

/**
 * The phases reachable from inside one action-list sync. The outer
 * importable-level phases (`starting`, `writingKnowledge`, `done`) are
 * not emitted by read/apply internals.
 */
export type ActionListProgressPhase =
    | "reading"
    | "hydrating"
    | "diffing"
    | "applying";

/**
 * The fields that come from one in-flight `syncActionList` call. Filled
 * by `readList.ts` / `applyDiff.ts` and forwarded to the parent
 * `onProgress` sink with the same field names — no rename layer.
 */
export type ActionListProgressFields = {
    phase: ImportPhase;
    phaseLabel: string;
    unitCompleted: number;
    unitTotal: number;
    parentUnitCompleted?: number;
    parentUnitTotal?: number;
    parentPhaseLabel?: string;
    estimatedCompleted: number;
    estimatedTotal: number;
    etaConfidence: EtaConfidence;
    /** Live per-phase budget for the in-flight action-list. Null between
     * action-list calls (e.g. while writing knowledge). */
    phaseBudget: ActionListPhaseBudget | null;
};

/**
 * Full progress record for an import session. Action-list-scope fields
 * are filled by the importer; importable + session-scope fields are
 * filled by `importSession.emitProgress`.
 */
export type ImportProgress = ActionListProgressFields & {
    // Importable scope
    currentKey: string;
    currentType: Importable["type"] | null;
    currentIdentity: string;
    orderIndex: number;
    rowStatus: ImportRunRowStatus | null;
    currentLabel: string;

    // Session scope
    completed: number;
    total: number;
    /** Cumulative weight of fully-completed importables in budget units.
     * Better signal for the progress bar than `completed/total` because
     * importables vary wildly in size. */
    weightCompleted: number;
    weightTotal: number;
    /** Estimated weight of the importable currently being processed. */
    weightCurrent: number;
    /** Initial estimated weights for every importable in this session,
     * indexed by `orderIndex`. Sums roughly to `weightTotal`. Used by
     * the GUI to draw per-importable divider tick marks. */
    weights: readonly number[];
    failed: number;
};

/** Callback shape that `readActionList` / `applyActionListDiff` invoke. */
export type ActionListProgressSink = (progress: ActionListProgressFields) => void;
