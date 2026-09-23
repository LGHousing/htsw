import { afterEach, describe, expect, it } from "vitest";

import {
    addToQueue,
    clearQueue,
    expandBulkQueueRow,
    getQueue,
    insertQueueRowsAfter,
    isQueueItemQueued,
    makeBulkQueueRow,
    makeImportableQueueRow,
    moveQueueRow,
    moveQueueRowsOnto,
    setQueueRowStatus,
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

describe("queue reordering", () => {
    const order = (): string[] =>
        getQueue().map((row) =>
            row.target.kind === "importable" ? row.target.identity : row.target.label
        );

    it("moves a bulk group with its children and skips other houses' rows", () => {
        const path = "C:/projects/root/import.json";
        const bulk = makeBulkQueueRow({
            op: "import",
            house: "here",
            path,
            scope: { kind: "file", path },
            filter: "all",
            label: "bulk",
        });
        addToQueue(functionItem(path, "first"));
        addToQueue({ ...functionItem(path, "elsewhere"), house: "there" });
        addToQueue(bulk);
        expandBulkQueueRow(bulk.key, [functionItem(path, "child")]);

        expect(moveQueueRow(bulk.key, "up", "here")).toBe(true);
        expect(order()).toEqual(["bulk", "child", "first", "elsewhere"]);
        expect(moveQueueRow(bulk.key, "up", "here")).toBe(false);

        const first = getQueue()[2];
        setQueueRowStatus(first.key, "running");
        expect(moveQueueRow(first.key, "top", "here")).toBe(false);
    });

    it("moves a selected batch as one block past the target row", () => {
        const path = "C:/projects/root/import.json";
        const [a, b, c, d] = ["a", "b", "c", "d"].map((name) => functionItem(path, name));
        for (const row of [a, b, c, d]) addToQueue(row);

        expect(moveQueueRowsOnto([a.key, b.key], c.key, null)).toBe(true);
        expect(order()).toEqual(["c", "a", "b", "d"]);
        expect(moveQueueRowsOnto([a.key, b.key], c.key, null)).toBe(true);
        expect(order()).toEqual(["a", "b", "c", "d"]);
    });

    it("pulls an already queued dependency into the session instead of skipping it", () => {
        const path = "C:/projects/root/import.json";
        const fn = functionItem(path, "uses item");
        const other = functionItem(path, "other");
        const item = makeImportableQueueRow({
            op: "import",
            house: null,
            path,
            type: "ITEM",
            identity: "Sword",
        });
        addToQueue(fn);
        addToQueue(other);
        addToQueue(item);

        const inserted = insertQueueRowsAfter(fn.key, [item]);

        expect(inserted.map((row) => row.key)).toEqual([item.key]);
        expect(order()).toEqual(["uses item", "Sword", "other"]);
    });
});
