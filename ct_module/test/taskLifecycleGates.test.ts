import { afterEach, describe, expect, test } from "vitest";

import { createExportProgressSink } from "../src/gui/export/progressSink";
import {
    clearTaskProgress,
    getTaskProgress,
} from "../src/gui/right-panel/import-tab/taskProgress";
import { runHousingSyncTask } from "../src/housingSync/taskRunner";
import { cancelActiveTask } from "../src/tasks/activeTask";
import { isTaskRunning } from "../src/tasks/runningState";

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
                expect(isTaskRunning(), phase).toBe(true);
            }

            clearTaskProgress();
            expect(isTaskRunning()).toBe(true);

            const second = createExportProgressSink("REGION", "");
            second.start(["second"]);
            second.item(0, "second");
            second.done();

            expect(getTaskProgress()).not.toBeNull();
            expect(isTaskRunning()).toBe(true);
        });

        expect(getTaskProgress()).toBeNull();
        expect(isTaskRunning()).toBe(false);
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
                expect(isTaskRunning()).toBe(true);
            }
        });

        await started.promise;
        expect(cancelActiveTask()).toBe(true);
        expect(getTaskProgress()).not.toBeNull();
        work.resolve();
        await cleanupStarted.promise;
        expect(getTaskProgress()).not.toBeNull();
        expect(isTaskRunning()).toBe(true);

        cleanupRelease.resolve();
        await expect(task).resolves.toBeUndefined();
        expect(getTaskProgress()).toBeNull();
        expect(isTaskRunning()).toBe(false);
    });
});
