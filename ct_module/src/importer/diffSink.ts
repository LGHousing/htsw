/**
 * Per-import diff event sink.
 *
 * The action sync engine (`applyActionListDiff`) calls into the active sink
 * as it walks operations so a UI can light up source-action lines as they
 * are touched. Paths identify nested actions, e.g. `4.ifActions.2`.
 */
import type { Action } from "htsw/types";

export type DiffOpKind = "edit" | "add" | "move" | "delete";
export type DiffFinalState = "match" | "edit" | "add" | "delete";
export type ActionPath = string;

export type DiffSummary = {
    matches: number;
    edits: number;
    moves: number;
    adds: number;
    deletes: number;
};

export interface ImportDiffSink {
    /** Human-readable phase label, e.g. "reading housing state". */
    phase(label: string): void;
    /** Operation counts for the current list diff. */
    summary(summary: DiffSummary): void;
    /** A desired source action has a planned operation. */
    planOp(actionPath: ActionPath, kind: DiffOpKind, label: string, detail: string): void;
    /** An observed Housing action has no source line and will be deleted. */
    deleteOp(index: number, label: string, detail: string): void;
    /** A desired action at this source path already matched observed. */
    markMatch(actionPath: ActionPath): void;
    /** The importer is starting work on the action at this source path. */
    beginOp(actionPath: ActionPath, kind: DiffOpKind, label: string): void;
    /** The op has finished; final color = `state`. */
    completeOp(actionPath: ActionPath, state: DiffFinalState): void;
    /** Sync done; clear any "currently working" highlight. */
    end(): void;
    /**
     * Optional: a desired action is being edited; provides the in-Housing
     * "before" action so the UI can render a side-by-side preview.
     */
    planEditWithObserved?(actionPath: ActionPath, observed: Action): void;
    /**
     * Optional: per-action read confirmation during the reading/hydration
     * phase. Drives the gray→vibrant fade-in. Coarse-grained (per inventory
     * page); see Phase 5 for sub-page granularity.
     */
    readActionComplete?(actionPath: ActionPath): void;
    /** Optional: the importer is about to edit field `prop` of this action. */
    beginField?(actionPath: ActionPath, prop: string): void;
    /** Optional: the importer finished editing field `prop`. */
    completeField?(actionPath: ActionPath, prop: string): void;
    /**
     * Optional: top-level read of housing actions complete. Each entry is
     * either a (possibly partially-hydrated) Action or null for a slot
     * that wasn't populated. Drives the read-phase preview to switch
     * from cache-snapshot to actual observed state.
     */
    setObservedSnapshot?(actions: ReadonlyArray<Action | null>): void;
    /**
     * Optional: a single nested-list hydration is complete. Replaces the
     * placeholder line(s) for `parentPath`.`prop` in the live preview
     * with the real hydrated children.
     */
    setHydratedNestedAction?(
        parentPath: ActionPath,
        prop: string,
        actions: ReadonlyArray<Action | null>
    ): void;
    /**
     * Optional: the importer is about to read (hydrate) the action at
     * this source path. Drives the blue ▶ cursor + autoscroll during
     * the read phase, so the user can see WHICH conditional/random is
     * being walked, not just a generic "hydrating" label.
     */
    setReading?(actionPath: ActionPath, label: string): void;
    /** Optional: the importer is no longer reading any specific action. */
    clearReading?(): void;
    /**
     * Optional: explicit per-op planning calls carrying full Action
     * payloads. The legacy `planOp` only conveys path + kind + label;
     * these variants give the live preview enough data to insert/morph
     * lines for the unified morph animation.
     */
    planAdd?(actionPath: ActionPath, desired: Action, toIndex: number): void;
    planEdit?(actionPath: ActionPath, observed: Action, desired: Action): void;
    planDelete?(actionPath: ActionPath, observed: Action): void;
    planMove?(actionPath: ActionPath, fromIndex: number, toIndex: number): void;
    /** Optional: the apply phase finished one op. Drives the per-line morph. */
    applyDone?(actionPath: ActionPath, finalState: DiffFinalState, kind: DiffOpKind): void;
    /**
     * Optional: end-of-import reconciliation. Carries the full source
     * action tree so the live preview can rebuild from a known-good
     * shape (catches edge cases the per-op morphs missed, notably
     * deep moves with nested children).
     */
    finalizeSource?(actions: ReadonlyArray<Action>): void;
}

let activeSink: ImportDiffSink | null = null;

export function setActiveDiffSink(sink: ImportDiffSink | null): void {
    activeSink = sink;
}

export function getActiveDiffSink(): ImportDiffSink | null {
    return activeSink;
}
