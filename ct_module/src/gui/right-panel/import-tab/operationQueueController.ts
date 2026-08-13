/// <reference types="../../../../CTAutocomplete" />

import { TaskManager } from "../../../tasks/manager";
import { runQueuedExport } from "../../export/taskController";
import { runQueuedRead } from "../../knowledge/deepRead";
import { showToast } from "../../toast";
import { runQueuedImport } from "./taskController";
import {
    getQueueLength,
    hasRunnableQueueItem,
    isImportQueueItem,
    isQueueProcessing,
    processQueue,
    type QueueExecutionResult,
    type QueueItem,
} from "./queue";

async function executeQueueItem(item: QueueItem): Promise<QueueExecutionResult> {
    if (isImportQueueItem(item)) return runQueuedImport(item);
    if (item.operation === "read") return runQueuedRead(item);
    return runQueuedExport(item);
}

export function startOperationQueue(): boolean {
    if (isQueueProcessing()) return false;
    if (getQueueLength() === 0) {
        showToast("Queue is empty", 0xffe5bc4b);
        return false;
    }
    if (!hasRunnableQueueItem()) {
        showToast("Retry or dismiss the first blocked queue entry", 0xffe5bc4b, 6000);
        return false;
    }
    if (TaskManager.isBusy()) {
        showToast(
            "Another task is still finishing — run the queue afterward",
            0xffe5bc4b
        );
        return false;
    }
    void processQueue(executeQueueItem).catch((error: unknown) => {
        showToast(`Queue stopped: ${String(error)}`, 0xffe85c5c, 8000);
    });
    return true;
}
