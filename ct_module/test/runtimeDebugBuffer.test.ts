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

    it("retains event history independently from the shorter packet tail", () => {
        const stats = runtimeDebugStats();
        const eventCapacity = (stats.eventRecords as { maxRecords: number }).maxRecords;
        const packetCapacity = (stats.packetRecords as { maxRecords: number }).maxRecords;
        for (let sequence = 0; sequence < packetCapacity + 3; sequence++) {
            recordRuntimeDebug("packet", { sequence: `packet-${sequence}` });
        }
        for (let sequence = 0; sequence < eventCapacity + 2; sequence++) {
            recordRuntimeDebug("entry", { sequence });
        }

        const records = recentRuntimeDebugRecords();
        expect(records).toHaveLength(eventCapacity + packetCapacity);
        expect(records.filter((record) => record.kind === "packet")[0].sequence).toBe(
            "packet-3"
        );
        expect(records.filter((record) => record.kind === "entry")[0].sequence).toBe(2);
        expect(runtimeDebugStats()).toMatchObject({
            retainedRecords: eventCapacity + packetCapacity,
            droppedRecords: 5,
            eventRecords: {
                retainedRecords: eventCapacity,
                droppedRecords: 2,
            },
            packetRecords: {
                retainedRecords: packetCapacity,
                droppedRecords: 3,
            },
        });
    });

    it("merges packet and event records in insertion order", () => {
        recordRuntimeDebug("first", { sequence: 1 });
        recordRuntimeDebug("packet", { sequence: 2 });
        recordRuntimeDebug("last", { sequence: 3 });

        expect(recentRuntimeDebugRecords().map((record) => record.sequence)).toEqual([
            1, 2, 3,
        ]);
    });

    it("releases retained records and resets ring state", () => {
        const packetCapacity = (
            runtimeDebugStats().packetRecords as { maxRecords: number }
        ).maxRecords;
        for (let sequence = 0; sequence <= packetCapacity; sequence++) {
            recordRuntimeDebug("packet", { sequence });
        }

        resetRuntimeDebugRecords();
        recordRuntimeDebug("fresh", { sequence: "fresh" });

        expect(recentRuntimeDebugRecords().map((record) => record.sequence)).toEqual(["fresh"]);
        expect(runtimeDebugStats()).toMatchObject({
            retainedRecords: 1,
            droppedRecords: 0,
            eventRecords: { retainedRecords: 1, droppedRecords: 0 },
            packetRecords: { retainedRecords: 0, droppedRecords: 0 },
        });
    });
});
