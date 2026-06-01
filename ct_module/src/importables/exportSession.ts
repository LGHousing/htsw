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
