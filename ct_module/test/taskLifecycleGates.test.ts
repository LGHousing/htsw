import { afterEach, describe, expect, test } from "vitest";

import { createExportProgressSink } from "../src/gui/export/progressSink";
import { requestTaskCancellation } from "../src/gui/right-panel/import-tab/cancelTask";
import {
    clearTaskProgress,
    getTaskProgress,
} from "../src/gui/right-panel/import-tab/taskProgress";
import { areTaskWideGatesActive } from "../src/gui/taskGates";
import { runHousingSyncTask } from "../src/housingSync/taskRunner";

function deferred(): {
    promise: Promise<void>;
    resolve: () => void;
} {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

afterEach(() => {
    clearTaskProgress();
});

describe("task-wide gates", () => {
    test("stay active through export cleanup and between batches", async () => {
        await runHousingSyncTask("export", async () => {
            const first = createExportProgressSink("FUNCTION", "");
            first.start(["first"]);
            first.item(0, "first");
            first.done();

            expect(getTaskProgress()).not.toBeNull();
            for (const phase of ["captured-item export", "inventory restore"]) {
                expect(areTaskWideGatesActive(), phase).toBe(true);
            }

            clearTaskProgress();
            expect(areTaskWideGatesActive()).toBe(true);

            const second = createExportProgressSink("REGION", "");
            second.start(["second"]);
            second.item(0, "second");
            second.done();

            expect(getTaskProgress()).not.toBeNull();
            expect(areTaskWideGatesActive()).toBe(true);
        });

        expect(getTaskProgress()).toBeNull();
        expect(areTaskWideGatesActive()).toBe(false);
    });

    test("stay active until cancellation cleanup completes", async () => {
        const work = deferred();
        const started = deferred();
        const cleanupStarted = deferred();
        const cleanupRelease = deferred();

        const task = runHousingSyncTask("export", async (ctx) => {
            const progress = createExportProgressSink("FUNCTION", "");
            progress.start(["cancelled"]);
            progress.item(0, "cancelled");
            started.resolve();
            try {
                await work.promise;
                ctx.checkCancelled();
            } finally {
                progress.done();
                cleanupStarted.resolve();
                await cleanupRelease.promise;
                expect(areTaskWideGatesActive()).toBe(true);
            }
        });

        await started.promise;
        expect(requestTaskCancellation()).toBe(true);
        expect(getTaskProgress()).not.toBeNull();
        work.resolve();
        await cleanupStarted.promise;
        expect(getTaskProgress()).not.toBeNull();
        expect(areTaskWideGatesActive()).toBe(true);

        cleanupRelease.resolve();
        await expect(task).resolves.toBeUndefined();
        expect(getTaskProgress()).toBeNull();
        expect(areTaskWideGatesActive()).toBe(false);
    });
});
