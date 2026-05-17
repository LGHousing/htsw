/**
 * Ambient flag marking that the current async stack is inside a top-level
 * `/export function` or `/export menu` operation.
 *
 * The importer's read path (`actions/readList.ts`) consults this — together
 * with the existing `mode.kind === "sync" && getCurrentWritingActionPath()`
 * check used by `/import` — to decide whether to fire live-preview animation
 * events (cursor moves, observed-snapshot emits, step-debug gates) during a
 * top-level read.
 *
 * Mirrors the pattern of `withWritingActionPath` in `importer/actions.ts`:
 * one set/restore wrapper, simple boolean state, no thread-local hacks
 * because the JS host is single-threaded.
 */

let inExportSession: boolean = false;

export function isInExportSession(): boolean {
    return inExportSession;
}

/**
 * Run `fn` with `isInExportSession() === true`. Restores the prior value
 * on completion or error. Nested calls (shouldn't happen at top level but
 * harmless if they do) preserve the existing `true` state.
 */
export async function withExportSession<T>(fn: () => Promise<T>): Promise<T> {
    const previous = inExportSession;
    inExportSession = true;
    try {
        return await fn();
    } finally {
        inExportSession = previous;
    }
}
