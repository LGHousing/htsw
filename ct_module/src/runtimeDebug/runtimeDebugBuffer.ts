type RuntimeDebugRecord = Record<string, unknown> & {
    kind: string;
    at: number;
    tMs: number;
};

const MAX_RECORDS = 20000;
let startedAt = Date.now();
const records: RuntimeDebugRecord[] = [];
let oldestRecordIndex = 0;
let droppedRecords = 0;

export function recordRuntimeDebug(
    kind: string,
    details: Record<string, unknown> = {}
): void {
    const now = Date.now();
    const record = {
        at: now,
        tMs: now - startedAt,
        kind,
        ...details,
    };
    if (records.length < MAX_RECORDS) {
        records.push(record);
        return;
    }

    records[oldestRecordIndex] = record;
    oldestRecordIndex = (oldestRecordIndex + 1) % MAX_RECORDS;
    droppedRecords++;
}

export function recentRuntimeDebugRecords(): RuntimeDebugRecord[] {
    if (oldestRecordIndex === 0) return records.slice();
    return records.slice(oldestRecordIndex).concat(records.slice(0, oldestRecordIndex));
}

export function resetRuntimeDebugRecords(): void {
    records.length = 0;
    oldestRecordIndex = 0;
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
