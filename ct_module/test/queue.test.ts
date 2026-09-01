import { afterEach, describe, expect, it } from "vitest";

import {
    addToQueue,
    clearQueue,
    getQueue,
    isQueueItemQueued,
    makeImportableQueueRow,
    toggleQueue,
    type QueueRow,
} from "../src/gui/right-panel/import-tab/queue";

function functionItem(path: string, identity: string): QueueRow {
    return makeImportableQueueRow({
        op: "import",
        house: null,
        path,
        type: "FUNCTION",
        identity,
        label: identity,
    });
}

afterEach(clearQueue);

describe("import queue work identity", () => {
    it("deduplicates the same operation, house, path, and target", () => {
        const rootItem = functionItem("C:/projects/root/import.json", "HPK Regions");
        const duplicate = functionItem("C:/projects/root/import.json", "HPK Regions");
        expect(addToQueue(rootItem).kind).toBe("added");
        expect(addToQueue(duplicate).kind).toBe("duplicate");

        expect(getQueue()).toHaveLength(1);
        expect(getQueue()[0]).toMatchObject({
            path: "C:/projects/root/import.json",
            target: { identity: "HPK Regions" },
        });
        expect(isQueueItemQueued(duplicate)).toBe(true);
        expect(toggleQueue(duplicate)).toBe(false);
        expect(getQueue()).toHaveLength(0);
    });

    it("allows the same target under different paths", () => {
        expect(
            addToQueue(functionItem("C:/projects/root/import.json", "HPK Regions")).kind
        ).toBe("added");
        expect(
            addToQueue(functionItem("C:/projects/other/import.json", "HPK Regions")).kind
        ).toBe("added");

        expect(getQueue()).toHaveLength(2);
    });
});
