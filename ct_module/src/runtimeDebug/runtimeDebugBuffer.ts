type RuntimeDebugRecord = Record<string, unknown> & {
    kind: string;
    at: number;
    tMs: number;
};

type BufferedRecord = {
    sequence: number;
    record: RuntimeDebugRecord;
};

type RuntimeDebugRing = {
    maxRecords: number;
    records: BufferedRecord[];
    oldestRecordIndex: number;
    droppedRecords: number;
};

const MAX_EVENT_RECORDS = 2000;
const MAX_PACKET_RECORDS = 500;
let startedAt = Date.now();
let nextSequence = 0;
const eventRecords = createRing(MAX_EVENT_RECORDS);
const packetRecords = createRing(MAX_PACKET_RECORDS);

function createRing(maxRecords: number): RuntimeDebugRing {
    return {
        maxRecords,
        records: [],
        oldestRecordIndex: 0,
        droppedRecords: 0,
    };
}

function appendRecord(ring: RuntimeDebugRing, record: RuntimeDebugRecord): void {
    const bufferedRecord = { sequence: nextSequence++, record };
    if (ring.records.length < ring.maxRecords) {
        ring.records.push(bufferedRecord);
        return;
    }

    ring.records[ring.oldestRecordIndex] = bufferedRecord;
    ring.oldestRecordIndex = (ring.oldestRecordIndex + 1) % ring.maxRecords;
    ring.droppedRecords++;
}

function chronologicalRecords(ring: RuntimeDebugRing): BufferedRecord[] {
    if (ring.oldestRecordIndex === 0) return ring.records.slice();
    return ring.records
        .slice(ring.oldestRecordIndex)
        .concat(ring.records.slice(0, ring.oldestRecordIndex));
}

function resetRing(ring: RuntimeDebugRing): void {
    ring.records.length = 0;
    ring.oldestRecordIndex = 0;
    ring.droppedRecords = 0;
}

function ringStats(ring: RuntimeDebugRing): Record<string, number> {
    return {
        maxRecords: ring.maxRecords,
        retainedRecords: ring.records.length,
        droppedRecords: ring.droppedRecords,
    };
}

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
    appendRecord(kind === "packet" ? packetRecords : eventRecords, record);
}

export function recentRuntimeDebugRecords(): RuntimeDebugRecord[] {
    return chronologicalRecords(eventRecords)
        .concat(chronologicalRecords(packetRecords))
        .sort((a, b) => a.sequence - b.sequence)
        .map((entry) => entry.record);
}

export function resetRuntimeDebugRecords(): void {
    resetRing(eventRecords);
    resetRing(packetRecords);
    nextSequence = 0;
    startedAt = Date.now();
}

export function runtimeDebugStats(): Record<string, unknown> {
    const retainedRecords = eventRecords.records.length + packetRecords.records.length;
    const droppedRecords = eventRecords.droppedRecords + packetRecords.droppedRecords;
    return {
        maxRecords: MAX_EVENT_RECORDS + MAX_PACKET_RECORDS,
        retainedRecords,
        droppedRecords,
        startedAt,
        eventRecords: ringStats(eventRecords),
        packetRecords: ringStats(packetRecords),
    };
}
