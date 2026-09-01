import { afterEach, describe, expect, it } from "vitest";

import type TaskContext from "../src/tasks/context";
import { getActiveTaskKind } from "../src/tasks/activeTask";
import { runHousingSyncTask } from "../src/housingSync/taskRunner";
import {
    addToQueue,
    clearQueue,
    getQueue,
    insertQueueRowsBefore,
    makeBulkQueueRow,
    makeImportableQueueRow,
    retryQueueRow,
    setQueueRowStatus,
    type BulkFilter,
    type QueueOp,
    type QueueRow,
} from "../src/gui/right-panel/import-tab/queue";
import {
    bulkFilterAllowed,
    drainQueue,
    matchesBulkCacheState,
    namesNotDeclared,
    runQueuedExportSession,
    type QueueRunnerDependencies,
    type QueueSessionResult,
} from "../src/gui/right-panel/import-tab/queueRunner";
import { exportHeldItem } from "../src/importables/items/export";
import type { runExportSession } from "../src/importables/export/session";
import { createExportProgressSink } from "../src/gui/export/progressSink";
import {
    clearTaskProgress,
    getTaskProgress,
} from "../src/gui/right-panel/import-tab/taskProgress";

const ctx = { checkCancelled: () => undefined } as unknown as TaskContext;

function row(
    label: string,
    op: QueueOp = "import",
    path = "/project/import.json",
    house: string | null = "house-a"
): QueueRow {
    return makeImportableQueueRow({
        op,
        house,
        path,
        type: "FUNCTION",
        identity: label,
        label,
    });
}

function enqueue(queueRow: QueueRow): void {
    const result = addToQueue(queueRow);
    expect(["added", "alsoQueuedOtherDirection"]).toContain(result.kind);
}

function complete(rows: readonly QueueRow[]): QueueSessionResult {
    return { completedKeys: rows.map((queueRow) => queueRow.key), failed: [] };
}

function dependencies(
    overrides: Partial<QueueRunnerDependencies> = {}
): QueueRunnerDependencies {
    return {
        currentHouse: async () => "house-a",
        beforeFirstImport: async () => undefined,
        expandBulk: async () => [],
        runImport: async (_ctx, rows) => complete(rows),
        runExport: async (_ctx, rows) => complete(rows),
        scheduleDone: (callback) => callback(),
        ...overrides,
    };
}

afterEach(() => {
    clearQueue();
    clearTaskProgress();
});

describe("operation queue drain", () => {
    it("preserves mixed order and groups only consecutive op/path/house rows", async () => {
        enqueue(row("import-a"));
        enqueue(row("import-b"));
        enqueue(row("export-a", "export", "/export/import.json"));
        enqueue(row("read-a", "read", "/read/import.json"));
        enqueue(row("import-c"));
        const calls: string[] = [];
        const deps = dependencies({
            runImport: async (_ctx, rows) => {
                calls.push(`import:${rows.map((r) => r.target.label).join(",")}`);
                return complete(rows);
            },
            runExport: async (_ctx, rows) => {
                calls.push(`${rows[0].op}:${rows.map((r) => r.target.label).join(",")}`);
                return complete(rows);
            },
        });

        await expect(drainQueue(ctx, deps)).resolves.toBe("idle");
        expect(calls).toEqual([
            "import:import-a,import-b",
            "export:export-a",
            "read:read-a",
            "import:import-c",
        ]);
        expect(getQueue()).toEqual([]);
    });

    it("expands bulk rows from fresh run-time results for every valid filter", async () => {
        const specs: Array<{ op: QueueOp; filter: BulkFilter; path: string }> = [
            { op: "export", filter: "all", path: "/all/import.json" },
            { op: "import", filter: "modified", path: "/modified/import.json" },
            { op: "export", filter: "new", path: "/new/import.json" },
            { op: "read", filter: "changed", path: "/changed/import.json" },
        ];
        for (const spec of specs) {
            enqueue(
                makeBulkQueueRow({
                    op: spec.op,
                    house: "house-a",
                    path: spec.path,
                    scope: { kind: "houseType", type: "FUNCTION" },
                    filter: spec.filter,
                    label: spec.filter,
                })
            );
        }
        const expanded: string[] = [];
        const ran: string[] = [];
        const deps = dependencies({
            expandBulk: async (_ctx, parent) => {
                if (parent.target.kind !== "bulk") return [];
                expanded.push(parent.target.filter);
                return [
                    makeImportableQueueRow({
                        op: parent.op,
                        house: parent.house,
                        path: parent.path,
                        type: "FUNCTION",
                        identity: `fresh-${parent.target.filter}`,
                        origin: "expansion",
                        parentKey: parent.key,
                    }),
                ];
            },
            runImport: async (_ctx, rows) => {
                ran.push(...rows.map((r) => r.target.label));
                return complete(rows);
            },
            runExport: async (_ctx, rows) => {
                ran.push(...rows.map((r) => r.target.label));
                return complete(rows);
            },
        });

        await drainQueue(ctx, deps);
        expect(expanded).toEqual(["all", "modified", "new", "changed"]);
        expect(ran).toEqual([
            "fresh-all",
            "fresh-modified",
            "fresh-new",
            "fresh-changed",
        ]);
    });

    it("skips another-house rows and runs them after the house changes", async () => {
        enqueue(row("other", "import", "/other/import.json", "house-b"));
        enqueue(row("local"));
        const ran: string[] = [];
        const deps = dependencies({
            runImport: async (_ctx, rows) => {
                ran.push(...rows.map((r) => r.target.label));
                return complete(rows);
            },
        });
        await drainQueue(ctx, deps);
        expect(ran).toEqual(["local"]);
        expect(getQueue().map((r) => r.target.label)).toEqual(["other"]);

        await drainQueue(ctx, { ...deps, currentHouse: async () => "house-b" });
        expect(ran).toEqual(["local", "other"]);
        expect(getQueue()).toEqual([]);
    });

    it("stops after an import failure with later work queued", async () => {
        const failed = row("failed");
        const later = row("later", "export", "/export/import.json");
        enqueue(failed);
        enqueue(later);
        let exports = 0;
        await drainQueue(
            ctx,
            dependencies({
                runImport: async () => ({
                    completedKeys: [],
                    failed: [{ key: failed.key, error: "boom" }],
                }),
                runExport: async (_ctx, rows) => {
                    exports++;
                    return complete(rows);
                },
            })
        );
        expect(exports).toBe(0);
        expect(getQueue().map((r) => [r.target.label, r.status])).toEqual([
            ["failed", "failed"],
            ["later", "queued"],
        ]);
    });

    it("isolates export failures and continues", async () => {
        const failed = row("failed-export", "export", "/export/import.json");
        const later = row("later-import");
        enqueue(failed);
        enqueue(later);
        const calls: string[] = [];
        await drainQueue(
            ctx,
            dependencies({
                runExport: async () => ({
                    completedKeys: [],
                    failed: [{ key: failed.key, error: "boom" }],
                }),
                runImport: async (_ctx, rows) => {
                    calls.push("import");
                    return complete(rows);
                },
            })
        );
        expect(calls).toEqual(["import"]);
        expect(getQueue()).toHaveLength(1);
        expect(getQueue()[0]).toMatchObject({ key: failed.key, status: "failed" });
    });

    it("requeues a cancelled session, pauses, and retries failed rows in place", async () => {
        const cancelled = row("cancelled");
        enqueue(cancelled);
        await expect(
            drainQueue(
                ctx,
                dependencies({
                    runImport: async () => ({
                        completedKeys: [],
                        failed: [],
                        cancelled: true,
                    }),
                })
            )
        ).resolves.toBe("paused");
        expect(getQueue()[0]).toMatchObject({ key: cancelled.key, status: "queued" });

        setQueueRowStatus(cancelled.key, "failed", "try again");
        expect(retryQueueRow(cancelled.key)).toBe(true);
        expect(getQueue()[0]).toMatchObject({
            key: cancelled.key,
            status: "queued",
            error: null,
        });
    });

    it("continues into conflict-review reads and fires their one-shot hook", async () => {
        const importing = row("conflicted");
        enqueue(importing);
        const calls: string[] = [];
        await drainQueue(
            ctx,
            dependencies({
                runImport: async () => {
                    const reads = insertQueueRowsBefore(importing.key, [
                        makeImportableQueueRow({
                            op: "read",
                            house: importing.house,
                            path: importing.path,
                            type: "FUNCTION",
                            identity: "conflicted",
                            origin: "dependency",
                        }),
                    ]);
                    return {
                        completedKeys: [],
                        failed: [],
                        cancelledKeys: [importing.key],
                        completionHooks: [
                            {
                                keys: reads.map((read) => read.key),
                                callback: () => calls.push("review-opened"),
                            },
                        ],
                    };
                },
                runExport: async (_ctx, rows) => {
                    calls.push(`read:${rows.map((r) => r.target.label).join(",")}`);
                    return complete(rows);
                },
            })
        );

        expect(calls).toEqual(["read:conflicted", "review-opened"]);
        expect(getQueue()).toHaveLength(1);
        expect(getQueue()[0]).toMatchObject({
            key: importing.key,
            status: "cancelled",
            error: "Cancelled for conflict review",
        });
        expect(retryQueueRow(importing.key)).toBe(true);
    });
});

describe("bulk filter semantics", () => {
    it("accepts only the design's operation/filter combinations", () => {
        expect(bulkFilterAllowed("import", "all")).toBe(true);
        expect(bulkFilterAllowed("import", "modified")).toBe(true);
        expect(bulkFilterAllowed("export", "new")).toBe(true);
        expect(bulkFilterAllowed("export", "changed")).toBe(true);
        expect(bulkFilterAllowed("read", "changed")).toBe(true);
        expect(bulkFilterAllowed("export", "modified")).toBe(false);
        expect(bulkFilterAllowed("read", "new")).toBe(false);
        expect(bulkFilterAllowed("import", "changed")).toBe(false);
    });

    it("distinguishes Auto-Track modified from trusted GUI differs", () => {
        expect(matchesBulkCacheState("modified", "unknown", false)).toBe(true);
        expect(matchesBulkCacheState("modified", "modified", false)).toBe(true);
        expect(matchesBulkCacheState("modified", "current", true)).toBe(false);
        expect(matchesBulkCacheState("changed", "modified", true)).toBe(true);
        expect(matchesBulkCacheState("changed", "modified", false)).toBe(false);
        expect(matchesBulkCacheState("changed", "unknown", true)).toBe(false);
    });

    it("computes new from fresh names minus reparsed declarations", () => {
        expect(namesNotDeclared(["fresh", "declared"], new Set(["declared"]))).toEqual([
            "fresh",
        ]);
    });
});

describe("queued held-item export", () => {
    it("captures at run time without passing the synthetic queue identity as a name", async () => {
        const held = makeImportableQueueRow({
            op: "export",
            house: "house-a",
            path: "/items/import.json",
            type: "ITEM",
            identity: "held item",
        });
        let reader: unknown;
        let names: readonly string[] | undefined;
        const fakeSession = (async (_ctx, _destination, batches) => {
            reader = batches[0].reader;
            names = batches[0].names;
            return { total: 1, succeeded: 1, failed: 0 };
        }) as typeof runExportSession;

        const result = await runQueuedExportSession(ctx, [held], "house-a", fakeSession);
        expect(reader).toBe(exportHeldItem);
        expect(names).toBeUndefined();
        expect(result).toEqual({ completedKeys: [held.key], failed: [] });
    });
});

describe("queued export destination", () => {
    it("reads the new-export target when the session starts", async () => {
        const queued = row("exported", "export", "/project/import.json");
        let target: string | undefined;
        const fakeSession = (async (_ctx, _destination, batches) => {
            target = batches[0].newExportTargetImportJson;
            return { total: 1, succeeded: 1, failed: 0 };
        }) as typeof runExportSession;

        await runQueuedExportSession(
            ctx,
            [queued],
            "house-a",
            fakeSession,
            () => "/project/functions/new.import.json"
        );

        expect(queued.path).toBe("/project/import.json");
        expect(target).toBe("/project/functions/new.import.json");
    });
});

describe("queued export progress", () => {
    it("uses the stable QueueRow key through reducer and completion", () => {
        const queued = row("exported", "export", "/exports/import.json");
        const finished: string[] = [];
        const sink = createExportProgressSink(
            "FUNCTION",
            queued.path,
            "export",
            undefined,
            {
                queueRows: [queued],
                onFinished: (key) => finished.push(key),
            }
        );
        sink.start(["exported"]);
        sink.item(0, "exported");
        sink.itemFinished?.(0);
        sink.done();

        expect(getTaskProgress()?.rows[0].key).toBe(queued.key);
        expect(finished).toEqual([queued.key]);
    });
});

describe("queue active-task lifecycle", () => {
    it("registers and clears the queue task kind", async () => {
        expect(getActiveTaskKind()).toBeNull();
        await runHousingSyncTask("queue", async () => {
            expect(getActiveTaskKind()).toBe("queue");
        });
        expect(getActiveTaskKind()).toBeNull();
    });
});
