import { beforeEach, describe, expect, it } from "vitest";

import {
    recentRuntimeDebugRecords,
    recordRuntimeDebug,
    resetRuntimeDebugRecords,
    runtimeDebugStats,
} from "../src/runtimeDebug/runtimeDebugBuffer";

describe("runtime debug buffer", () => {
    beforeEach(() => resetRuntimeDebugRecords());

    it("returns records in insertion order before reaching capacity", () => {
        recordRuntimeDebug("first", { sequence: 1 });
        recordRuntimeDebug("second", { sequence: 2 });

        expect(recentRuntimeDebugRecords().map((record) => record.sequence)).toEqual([1, 2]);
    });

    it("overwrites old records while preserving chronological order", () => {
        const capacity = runtimeDebugStats().maxRecords as number;
        for (let sequence = 0; sequence < capacity + 3; sequence++) {
            recordRuntimeDebug("entry", { sequence });
        }

        const records = recentRuntimeDebugRecords();
        expect(records).toHaveLength(capacity);
        expect(records[0].sequence).toBe(3);
        expect(records[records.length - 1].sequence).toBe(capacity + 2);
        expect(runtimeDebugStats()).toMatchObject({
            retainedRecords: capacity,
            droppedRecords: 3,
        });
    });

    it("releases retained records and resets ring state", () => {
        const capacity = runtimeDebugStats().maxRecords as number;
        for (let sequence = 0; sequence <= capacity; sequence++) {
            recordRuntimeDebug("entry", { sequence });
        }

        resetRuntimeDebugRecords();
        recordRuntimeDebug("fresh", { sequence: "fresh" });

        expect(recentRuntimeDebugRecords().map((record) => record.sequence)).toEqual(["fresh"]);
        expect(runtimeDebugStats()).toMatchObject({
            retainedRecords: 1,
            droppedRecords: 0,
        });
    });
});
