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
import { drainQueue } from "@htsw/importer/runtime/queueRunner";

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
