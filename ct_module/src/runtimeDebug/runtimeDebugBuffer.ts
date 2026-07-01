type RuntimeDebugRecord = Record<string, unknown> & {
    kind: string;
    at: number;
    tMs: number;
};

const MAX_RECORDS = 20000;
let startedAt = Date.now();
const records: RuntimeDebugRecord[] = [];
let droppedRecords = 0;

export function recordRuntimeDebug(
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

export function recentRuntimeDebugRecords(): RuntimeDebugRecord[] {
    return records.slice();
}

export function resetRuntimeDebugRecords(): void {
    records.length = 0;
    droppedRecords = 0;
    startedAt = Date.now();
}

export function runtimeDebugStats(): Record<string, unknown> {
    return {
        maxRecords: MAX_RECORDS,
        retainedRecords: records.length,
        droppedRecords,
        startedAt,
    };
}
