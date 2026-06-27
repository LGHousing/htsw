type ImportDiagnosticRecord = Record<string, unknown> & {
    kind: string;
    at: number;
    tMs: number;
};

const MAX_RECORDS = 20000;
let startedAt = Date.now();
const records: ImportDiagnosticRecord[] = [];
let droppedRecords = 0;

export function recordImportDiagnostic(
    kind: string,
    details: Record<string, unknown> = {}
): void {
    records.push({
        at: Date.now(),
        tMs: Date.now() - startedAt,
        kind,
        ...details,
    });
    if (records.length > MAX_RECORDS) {
        records.shift();
        droppedRecords++;
    }
}

export function recentImportDiagnostics(): ImportDiagnosticRecord[] {
    return records.slice();
}

export function resetImportDiagnostics(): void {
    records.length = 0;
    droppedRecords = 0;
    startedAt = Date.now();
}

export function importDiagnosticStats(): Record<string, unknown> {
    return {
        maxRecords: MAX_RECORDS,
        retainedRecords: records.length,
        droppedRecords,
        startedAt,
    };
}
