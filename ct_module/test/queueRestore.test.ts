import { afterEach, describe, expect, it } from "vitest";

import {
    addToQueue,
    captureQueueItems,
    clearQueue,
    getQueue,
    isRestoredQueueItem,
    makeImportableQueueRow,
    queueItemKey,
    reconcileAutoTrackedQueue,
    removeFromQueue,
    restoreQueueItems,
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

const SOURCE = "C:/projects/root/import.json";

afterEach(clearQueue);

describe("queue workspace capture", () => {
    it("saves hand-queued rows but not auto-tracked ones", () => {
        const manual = functionItem(SOURCE, "Manual");
        addToQueue(manual);
        reconcileAutoTrackedQueue([functionItem(SOURCE, "Tracked")]);

        expect(getQueue()).toHaveLength(2);
        // Auto-tracked rows are regenerated from disk state on the next pass,
        // so saving them would only reintroduce stale rows.
        expect(captureQueueItems().map((i) => queueItemKey(i))).toEqual([
            queueItemKey(manual),
        ]);
    });
});

describe("restored queue rows and Auto-run", () => {
    it("marks restored rows so Auto-run cannot act on them", () => {
        const item = functionItem(SOURCE, "Restored");
        restoreQueueItems([item]);

        expect(getQueue()).toHaveLength(1);
        expect(isRestoredQueueItem(queueItemKey(item))).toBe(true);
    });

    it("clears the mark once Auto-Track independently re-detects the row", () => {
        const item = functionItem(SOURCE, "Restored");
        restoreQueueItems([item]);
        expect(isRestoredQueueItem(queueItemKey(item))).toBe(true);

        // Auto-Track reporting the same work is the evidence Auto-run was
        // waiting for; the row becomes eligible without being re-added.
        reconcileAutoTrackedQueue([functionItem(SOURCE, "Restored")]);

        expect(getQueue()).toHaveLength(1);
        expect(isRestoredQueueItem(queueItemKey(item))).toBe(false);
    });

    it("a restored row stays ineligible while Auto-Track reports other work", () => {
        const restored = functionItem(SOURCE, "Restored");
        restoreQueueItems([restored]);
        reconcileAutoTrackedQueue([functionItem(SOURCE, "Different")], false);

        expect(isRestoredQueueItem(queueItemKey(restored))).toBe(true);
    });

    it("drops the mark when the row leaves the queue", () => {
        const item = functionItem(SOURCE, "Restored");
        restoreQueueItems([item]);
        removeFromQueue(item);

        expect(isRestoredQueueItem(queueItemKey(item))).toBe(false);
        // A later hand-queue of the same work is genuine user intent and must
        // not inherit the restored row's disarmed state.
        addToQueue(item);
        expect(isRestoredQueueItem(queueItemKey(item))).toBe(false);
    });

    it("does not duplicate a row that is already queued", () => {
        const item = functionItem(SOURCE, "Manual");
        addToQueue(item);
        restoreQueueItems([functionItem(SOURCE, "Manual")]);

        expect(getQueue()).toHaveLength(1);
        // It was already there by hand, so it keeps its eligible status.
        expect(isRestoredQueueItem(queueItemKey(item))).toBe(false);
    });
});
