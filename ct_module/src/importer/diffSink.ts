/**
 * Per-import diff event sink.
 *
 * The action sync engine (`applyActionListDiff`) calls into the active sink
 * as it walks operations so a UI can light up source-action lines as they
 * are touched. Each importable gets its own sink (assigned by the session
 * before the importable runs and cleared after), so nested syncs inside a
 * parent op do not leak events — `applyActionListDiff` clears the sink on
 * entry and restores on exit, leaving only the outermost top-level sync
 * visible to the listener.
 */
export type DiffOpKind = "edit" | "add" | "move" | "delete";
export type DiffFinalState = "match" | "edit" | "add" | "delete";

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
    planOp(actionIndex: number, kind: DiffOpKind, label: string, detail: string): void;
    /** An observed Housing action has no source line and will be deleted. */
    deleteOp(index: number, label: string, detail: string): void;
    /** A desired action at this source index already matched observed. */
    markMatch(actionIndex: number): void;
    /** The importer is starting work on the action at this source index. */
    beginOp(actionIndex: number, kind: DiffOpKind, label: string): void;
    /** The op has finished; final color = `state`. */
    completeOp(actionIndex: number, state: DiffFinalState): void;
    /** Sync done; clear any "currently working" highlight. */
    end(): void;
}

let activeSink: ImportDiffSink | null = null;

export function setActiveDiffSink(sink: ImportDiffSink | null): void {
    activeSink = sink;
}

export function getActiveDiffSink(): ImportDiffSink | null {
    return activeSink;
}
