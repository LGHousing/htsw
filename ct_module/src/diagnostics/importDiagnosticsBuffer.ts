type ImportDiagnosticRecord = Record<string, unknown> & {
    kind: string;
    at: number;
    tMs: number;
};

const MAX_RECORDS = 500;
const startedAt = Date.now();
const records: ImportDiagnosticRecord[] = [];

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
    if (records.length > MAX_RECORDS) records.shift();
}

export function recentImportDiagnostics(): ImportDiagnosticRecord[] {
    return records.slice();
}
