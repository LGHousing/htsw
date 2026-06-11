// Outcome of a batch export-all run, uniform across importable types so the
// generic Houses-tab export controller can report results without knowing the
// concrete type.
export type ExportResult = { total: number; succeeded: number; failed: number };

let inExportSession: boolean = false;

export async function withExportSession<T>(fn: () => Promise<T>): Promise<T> {
    const previous = inExportSession;
    inExportSession = true;
    try {
        return await fn();
    } finally {
        inExportSession = previous;
    }
}
