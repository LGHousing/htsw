import { afterEach, describe, expect, it } from "vitest";

import {
    addToQueue,
    clearQueue,
    expandBulkQueueRow,
    getQueue,
    groupQueueRowsByHouse,
    makeBulkQueueRow,
    makeImportableQueueRow,
    queueWorkRowCount,
    runnableQueueRowCount,
    type QueueRow,
} from "../src/gui/right-panel/import-tab/queue";

const PATH = "C:/projects/root/import.json";

function functionRow(house: string | null, identity: string): QueueRow {
    return makeImportableQueueRow({
        op: "import",
        house,
        path: PATH,
        type: "FUNCTION",
        identity,
    });
}

afterEach(clearQueue);

describe("queue panel house groups", () => {
    it("puts current-house and house-less rows first, then one group per other house", () => {
        addToQueue(functionRow("house-b", "Remote One"));
        addToQueue(functionRow("house-a", "Local"));
        addToQueue(functionRow(null, "Anywhere"));
        addToQueue(functionRow("house-b", "Remote Two"));
        addToQueue(functionRow("house-c", "Elsewhere"));

        const groups = groupQueueRowsByHouse(getQueue(), "house-a");
        expect(groups.map((group) => [group.house, group.current])).toEqual([
            ["house-a", true],
            ["house-b", false],
            ["house-c", false],
        ]);
        expect(groups[0].rows.map((row) => row.target.label)).toEqual([
            "Local",
            "Anywhere",
        ]);
        expect(groups[1].rows.map((row) => row.target.label)).toEqual([
            "Remote One",
            "Remote Two",
        ]);
    });

    it("omits the current group when nothing is queued for this house", () => {
        addToQueue(functionRow("house-b", "Remote"));
        const groups = groupQueueRowsByHouse(getQueue(), "house-a");
        expect(groups).toHaveLength(1);
        expect(groups[0].current).toBe(false);
    });
});

describe("queue panel counts", () => {
    it("counts an expanded bulk row by its children, not the parent", () => {
        const bulk = makeBulkQueueRow({
            op: "read",
            house: "house-a",
            path: PATH,
            scope: { kind: "houseType", type: "FUNCTION" },
            filter: "all",
            label: "Read all functions",
        });
        addToQueue(bulk);
        expect(queueWorkRowCount(getQueue())).toBe(1);

        expandBulkQueueRow(bulk.key, [
            {
                op: "read",
                house: "house-a",
                path: PATH,
                target: { kind: "importable", type: "FUNCTION", identity: "A", label: "A" },
                origin: "expansion",
                status: "queued",
                error: null,
                parentKey: null,
            },
            {
                op: "read",
                house: "house-a",
                path: PATH,
                target: { kind: "importable", type: "FUNCTION", identity: "B", label: "B" },
                origin: "expansion",
                status: "queued",
                error: null,
                parentKey: null,
            },
        ]);
        expect(getQueue()).toHaveLength(3);
        expect(queueWorkRowCount(getQueue())).toBe(2);
    });

    it("counts only queued rows for the current house as runnable", () => {
        addToQueue(functionRow("house-a", "Local"));
        addToQueue(functionRow(null, "Anywhere"));
        addToQueue(functionRow("house-b", "Remote"));
        addToQueue({ ...functionRow("house-a", "Broken"), status: "failed", error: "x" });

        expect(runnableQueueRowCount(getQueue(), "house-a")).toBe(2);
        expect(runnableQueueRowCount(getQueue(), "house-b")).toBe(2);
    });
});
