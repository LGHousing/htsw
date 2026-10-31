import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, expect, it, vi } from "vitest";
import type TaskContext from "@htsw/importer/tasks/context";
import {
    addToQueue,
    clearQueue,
    getQueue,
    makeBulkQueueRow,
    makeImportableQueueRow,
} from "@htsw/importer/runtime/queue";
import {
    drainQueue,
    startQueue,
    queueRunState,
} from "@htsw/importer/runtime/queueRunner";

import { runHousingSyncTask } from "@htsw/importer/housingSync/taskRunner";
import { finishProjectRun } from "@htsw/importer/prune/projectRun";
import { runImportQueueSession } from "@htsw/importer/runtime/taskController";
import { parseImportJsonCurrent } from "@htsw/importer/runtime/parsing/parses";

const mainThread = vi.hoisted(() => [] as Array<() => void>);
vi.mock("@htsw/importer/utils/mainThread", () => ({
    runOnMainThread: (callback: () => void) => mainThread.push(callback),
}));
vi.mock("@htsw/importer/housingSync/taskRunner", () => ({
    runHousingSyncTask: vi.fn(
        async (_kind: string, run: (ctx: TaskContext) => Promise<unknown>) => run(ctx)
    ),
}));
vi.mock("@htsw/importer/importCache/housingId", () => ({
    getCurrentHousingUuid: async () => "house-a",
}));
vi.mock("@htsw/importer/housingSync/sideEffects", () => ({
    gmcOnImportStart: async () => undefined,
    waitForCreativeMode: async () => true,
}));
vi.mock("@htsw/importer/prune/projectRun", () => ({
    beginProjectRun: async () => undefined,
    finishProjectRun: vi.fn(async () => undefined),
}));
vi.mock("@htsw/importer/runtime/parsing/parses", () => ({
    parseImportJsonCurrent: vi.fn(),
}));
vi.mock("@htsw/importer/importCache/status", () => ({
    buildCacheStatusRow: () => ({ state: "current" }),
}));
vi.mock("@htsw/importer/runtime/taskController", () => ({
    runImportQueueSession: vi.fn(),
}));

// Exercise queue mutations after the production build's loose ES5 transform.
vi.mock("@htsw/importer/runtime/queue", async () => {
    const filename = new URL("../../importer/src/runtime/queue.ts", import.meta.url);
    const compiled = ts.transpileModule(readFileSync(filename, "utf8"), {
        compilerOptions: {
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.CommonJS,
        },
    }).outputText;
    const require = createRequire(import.meta.url);
    const { transformSync } = require("@babel/core") as {
        transformSync: (source: string, options: unknown) => { code: string };
    };
    const code = transformSync(compiled, {
        presets: [
            [
                require.resolve("@babel/preset-env"),
                { targets: { ie: "11" }, loose: true },
            ],
        ],
    }).code;
    const modules = new Map<string, unknown>();
    for (const match of compiled.matchAll(/require\("([^" ]+)"\)/g)) {
        modules.set(
            match[1],
            await vi.importActual(new URL(match[1] + ".ts", filename).pathname)
        );
    }
    const exports = {};
    runInNewContext(code, { require: (name: string) => modules.get(name), exports });
    return exports;
});

const ctx = {
    checkCancelled: () => undefined,
    elapsedMs: () => 12_000,
} as unknown as TaskContext;

afterEach(() => {
    vi.restoreAllMocks();
    clearQueue();
});

it("removes a manual project and all three children after the completion delay", async () => {
    vi.useFakeTimers();
    try {
        const path = "/project/import.json";
        addToQueue(
            makeBulkQueueRow({
                op: "import",
                house: "house-a",
                path,
                scope: { kind: "file", path },
                filter: "modified",
                label: "project",
            })
        );
        const imported: string[] = [];
        const finishProject = vi.fn(async () => undefined);
        await expect(
            drainQueue(ctx, {
                currentHouse: async () => "house-a",
                beforeFirstImport: async () => undefined,
                beginProject: async () => undefined,
                runExport: async () => {
                    throw new Error("unexpected export");
                },
                expandBulk: async () =>
                    ["A", "B", "C"].map((identity) =>
                        makeImportableQueueRow({
                            op: "import",
                            house: "house-a",
                            path,
                            type: "FUNCTION",
                            identity,
                        })
                    ),
                runImport: async (_ctx, rows) => {
                    imported.push(...rows.map((r) => r.target.label));
                    return { completedKeys: rows.map((r) => r.key), failed: [] };
                },
                finishProject,
                scheduleDone: (callback) => setTimeout(callback, 1500),
            })
        ).resolves.toBe("idle");
        expect(imported).toEqual(["A", "B", "C"]);
        expect(finishProject).toHaveBeenCalledOnce();
        expect(getQueue().map((r) => r.status)).toEqual([
            "running",
            "running",
            "running",
            "running",
        ]);
        await vi.advanceTimersByTimeAsync(1500);
        expect(getQueue()).toEqual([]);
    } finally {
        vi.useRealTimers();
    }
});

// Use the real queue-start timer path. CT fires each timer on its own Java
// thread; queued main-thread callbacks must run before they mutate the queue.
it.each(["skipped", "removals only", "failed", "cancelled", "paused"] as const)(
    "finishes a project safely when its last work is %s",
    async (ending) => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mainThread.length = 0;
        try {
            const path = "/project/import.json";
            const project = makeBulkQueueRow({
                op: "import",
                house: "house-a",
                path,
                scope: { kind: "file", path },
                filter: "all",
                label: "project",
            });
            addToQueue(project);
            vi.mocked(parseImportJsonCurrent).mockResolvedValue({
                parsed: {
                    value:
                        ending === "removals only"
                            ? []
                            : ["A", "B", "C"].map((name) => ({ type: "FUNCTION", name })),
                },
            } as never);
            vi.mocked(runImportQueueSession).mockImplementation(async (_ctx, rows) => ({
                // The import session reports skipped rows as completed too.
                completedKeys: ending === "skipped" ? rows.map((row) => row.key) : [],
                failed:
                    ending === "failed" ? [{ key: rows[0].key, error: "failed" }] : [],
                cancelledKeys: ending === "cancelled" ? [rows[0].key] : [],
                cancelled: ending === "paused",
            }));
            expect(startQueue()).toBe(true);
            await vi.mocked(runHousingSyncTask).mock.results[0].value;
            await vi.advanceTimersByTimeAsync(1500);
            if (ending === "failed" || ending === "cancelled" || ending === "paused") {
                expect(finishProjectRun).not.toHaveBeenCalled();
                expect(mainThread).toHaveLength(0);
                expect(getQueue()).toHaveLength(4);
                expect(getQueue()[1].status).toBe(
                    ending === "paused" ? "queued" : ending
                );
                expect(queueRunState()).toBe(ending === "paused" ? "paused" : "idle");
            } else {
                expect(finishProjectRun).toHaveBeenCalledOnce();
                expect(mainThread).toHaveLength(ending === "skipped" ? 2 : 1);
                expect(getQueue()[0].key).toBe(project.key);
                while (mainThread.length > 0) mainThread.shift()!();
                expect(getQueue()).toEqual([]);
                expect(addToQueue(project).kind).toBe("added");
            }
        } finally {
            vi.useRealTimers();
        }
    }
);
