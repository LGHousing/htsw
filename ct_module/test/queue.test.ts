import { afterEach, describe, expect, it } from "vitest";

import {
    addToQueueDetailed,
    addToQueue,
    beginQueueSession,
    cancelQueueItem,
    clearQueue,
    getQueueItemState,
    getQueue,
    queueDisplayGroups,
    isQueueItemQueued,
    processQueue,
    queueItemKey,
    retryQueueItem,
    toggleQueue,
    type ExportQueueItem,
    type ImportQueueItem,
} from "../src/gui/right-panel/import-tab/queue";

function functionItem(sourcePath: string, identity: string): ImportQueueItem {
    return {
        operation: "import",
        kind: "importable",
        sourcePath,
        type: "FUNCTION",
        identity,
        label: identity,
    };
}

function houseItem(
    operation: "export" | "read",
    identity: string,
    destinationPath = "C:/projects/root/import.json",
    all = false
): ExportQueueItem {
    return {
        operation,
        kind: "importable",
        destinationPath,
        housingUuid: "house-1",
        type: "FUNCTION",
        identity,
        label: identity,
        all,
    };
}

afterEach(clearQueue);

describe("import queue work identity", () => {
    it("rejects the same Housing target arriving through another project root", () => {
        const rootItem = functionItem("C:/projects/root/import.json", "HPK Regions");
        const nestedItem = functionItem("C:/projects/nested/import.json", "HPK Regions");
        expect(addToQueue(rootItem)).toBe(true);
        expect(addToQueue(nestedItem)).toBe(false);

        expect(getQueue()).toHaveLength(1);
        expect(getQueue()[0]).toMatchObject({
            sourcePath: "C:/projects/root/import.json",
            identity: "HPK Regions",
        });
        expect(isQueueItemQueued(nestedItem)).toBe(true);
        expect(toggleQueue(nestedItem)).toBe(false);
        expect(getQueue()).toHaveLength(0);
    });

    it("still allows distinct Housing targets", () => {
        expect(
            addToQueue(functionItem("C:/projects/root/import.json", "HPK Regions"))
        ).toBe(true);
        expect(
            addToQueue(functionItem("C:/projects/root/import.json", "HPK Completion"))
        ).toBe(true);

        expect(getQueue()).toHaveLength(2);
    });
});

describe("unified operation queue", () => {
    it("snapshots only the work admitted to the active operation", () => {
        const active = functionItem("C:/projects/root/import.json", "Active");
        const unrelated = houseItem("export", "Unrelated");
        addToQueueDetailed(active);
        addToQueueDetailed(unrelated);

        beginQueueSession([queueItemKey(active)]);

        expect(queueDisplayGroups()).toMatchObject({
            active: [active],
            pending: [unrelated],
            showDivider: true,
        });
    });

    it("keeps mixed operation types in insertion order", () => {
        const imp = functionItem("C:/projects/root/import.json", "Import me");
        const read = houseItem("read", "Read me");
        const exp = houseItem("export", "Export me");

        expect(addToQueueDetailed(imp).kind).toBe("added");
        expect(addToQueueDetailed(read).kind).toBe("added");
        expect(addToQueueDetailed(exp).kind).toBe("added");

        expect(getQueue().map((item) => item.operation)).toEqual([
            "import",
            "read",
            "export",
        ]);
        expect(getQueue().map((item) => getQueueItemState(item).status)).toEqual([
            "queued",
            "queued",
            "queued",
        ]);
        expect(queueDisplayGroups().active).toEqual([imp, read, exp]);
    });

    it("shows the same FIFO order that the runner uses", () => {
        const exportFirst = houseItem("export", "Export first");
        const itemImport: ImportQueueItem = {
            operation: "import",
            kind: "importable",
            sourcePath: "C:/projects/root/import.json",
            type: "ITEM",
            identity: "Item later",
            label: "Item later",
        };
        addToQueueDetailed(exportFirst);
        addToQueueDetailed(itemImport);

        expect(queueDisplayGroups().active).toEqual([exportFirst, itemImport]);
    });

    it("keeps directional conflicts visible and blocks them until retry is safe", () => {
        const imp = functionItem("C:/projects/root/import.json", "Shared target");
        const exp = houseItem("export", "Shared target");

        expect(addToQueueDetailed(imp).kind).toBe("added");
        const conflict = addToQueueDetailed(exp);

        expect(conflict.kind).toBe("blocked");
        expect(getQueue()).toHaveLength(2);
        expect(getQueueItemState(exp).status).toBe("blocked");
        expect(getQueueItemState(exp).error).toContain("Import");

        expect(retryQueueItem(queueItemKey(exp))).toBe(false);
        cancelQueueItem(queueItemKey(imp));
        expect(retryQueueItem(queueItemKey(exp))).toBe(true);
        expect(getQueueItemState(exp)).toEqual({ status: "queued", error: null });
    });

    it("treats a refreshed bulk operation as conflicting with individual reverse work", () => {
        const oneImport = functionItem("C:/projects/root/import.json", "One");
        const exportAll = houseItem("export", "All functions", undefined, true);
        addToQueueDetailed(oneImport);

        expect(addToQueueDetailed(exportAll).kind).toBe("blocked");
        expect(getQueueItemState(exportAll).error).toContain("Import");
    });

    it("coalesces overlapping bulk and individual work in the same direction", () => {
        const exportAll = houseItem("export", "All functions", undefined, true);
        const exportOne = houseItem("export", "One");
        addToQueueDetailed(exportAll);

        expect(addToQueueDetailed(exportOne).kind).toBe("duplicate");
        expect(getQueue()).toEqual([exportAll]);
    });

    it("keeps same-direction work distinct across houses and destinations", () => {
        const first = houseItem("export", "Shared", "C:/one/import.json");
        const anotherDestination = houseItem("export", "Shared", "C:/two/import.json");
        const anotherHouse = {
            ...houseItem("export", "Shared", "C:/one/import.json"),
            housingUuid: "house-2",
        };
        addToQueueDetailed(first);

        expect(addToQueueDetailed(anotherDestination).kind).toBe("added");
        expect(addToQueueDetailed(anotherHouse).kind).toBe("added");
    });

    it("blocks reverse work when a whole import.json has unresolved targets", () => {
        const wholeProject: ImportQueueItem = {
            operation: "import",
            kind: "importJson",
            sourcePath: "C:/projects/root/import.json",
            label: "import.json",
        };
        const read = houseItem("read", "Maybe declared here");
        addToQueueDetailed(wholeProject);

        expect(addToQueueDetailed(read).kind).toBe("blocked");

        clearQueue();
        addToQueueDetailed(read);
        expect(addToQueueDetailed(wholeProject).kind).toBe("blocked");
    });

    it("retains failed and cancelled work for an explicit retry", async () => {
        const failed = houseItem("read", "Fails");
        const later = houseItem("export", "Later");
        addToQueueDetailed(failed);
        addToQueueDetailed(later);

        await processQueue(async (item) =>
            item === failed
                ? { kind: "failed", error: "Housing menu closed" }
                : { kind: "success" }
        );

        expect(getQueueItemState(failed)).toEqual({
            status: "failed",
            error: "Housing menu closed",
        });
        expect(getQueueItemState(later).status).toBe("queued");
        expect(retryQueueItem(queueItemKey(failed))).toBe(true);

        await processQueue(async (item) =>
            item === failed ? { kind: "cancelled" } : { kind: "success" }
        );
        expect(getQueueItemState(failed).status).toBe("cancelled");
        expect(getQueue()).toContain(later);
        expect(retryQueueItem(queueItemKey(failed))).toBe(true);
    });

    it("continues with work enqueued while an operation is running", async () => {
        const first = houseItem("read", "First");
        const addedDuringRun = houseItem("export", "Added later");
        addToQueueDetailed(first);
        const seen: string[] = [];

        await processQueue(async (item) => {
            seen.push(item.label);
            if (item === first) addToQueueDetailed(addedDuringRun);
            return { kind: "success" };
        });

        expect(seen).toEqual(["First", "Added later"]);
        expect(getQueue()).toEqual([]);
    });
});
