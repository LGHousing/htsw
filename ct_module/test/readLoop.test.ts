import { describe, expect, it, vi } from "vitest";

vi.mock("../src/tasks/manager", () => ({
    isTaskCancelled: (error: unknown) =>
        error instanceof Error && error.message === "CANCELLED",
}));

import { runReadLoop } from "../src/importables/read";
import type TaskContext from "../src/tasks/context";
import type { ExportProgressSink } from "../src/housingSync/progress/types";

function fakeCtx() {
    return {
        checkCancelled: vi.fn(),
        displayMessage: vi.fn(),
    } as unknown as TaskContext;
}

function fakeSink() {
    const calls: string[] = [];
    const sink: ExportProgressSink = {
        start: (names) => calls.push(`start:${names.join(",")}`),
        scanStarted: () => calls.push("scanStarted"),
        item: (index, name) => calls.push(`item:${index}:${name}`),
        itemReactivated: (index) => calls.push(`reactivated:${index}`),
        itemFinished: (index) => calls.push(`finished:${index}`),
        itemProgress: () => calls.push("progress"),
        itemFailed: (index, error) => calls.push(`failed:${index}:${error}`),
        done: () => calls.push("done"),
    };
    return { sink, calls };
}

describe("runReadLoop", () => {
    it("reports two-pass item lifecycle in scan then hydrate order", async () => {
        const { sink, calls } = fakeSink();
        await runReadLoop(fakeCtx(), {
            names: ["a", "b"],
            verb: "Exporting",
            progress: sink,
            processOne: async () => {},
            scanOne: async (_ctx, name) => name,
            hydrateOne: async () => {},
        });
        expect(calls).toEqual([
            "start:a,b",
            "scanStarted",
            "item:0:a",
            "item:1:b",
            "reactivated:0",
            "finished:0",
            "reactivated:1",
            "finished:1",
            "done",
        ]);
    });

    it("reports single-pass item lifecycle in processing order", async () => {
        const { sink, calls } = fakeSink();
        await runReadLoop(fakeCtx(), {
            names: ["a", "b"],
            verb: "Exporting",
            progress: sink,
            processOne: async () => {},
        });
        expect(calls).toEqual([
            "start:a,b",
            "item:0:a",
            "finished:0",
            "item:1:b",
            "finished:1",
            "done",
        ]);
    });

    it("does not finish failed single-pass items and continues", async () => {
        const { sink, calls } = fakeSink();
        await runReadLoop(fakeCtx(), {
            names: ["a", "b"],
            verb: "Exporting",
            progress: sink,
            processOne: async (_ctx, name) => {
                if (name === "a") throw new Error("boom");
            },
        });
        expect(calls).toContain("failed:0:Error: boom");
        expect(calls).not.toContain("finished:0");
        expect(calls).toContain("finished:1");
    });

    it("does not finish failed hydrate items and continues", async () => {
        const { sink, calls } = fakeSink();
        await runReadLoop(fakeCtx(), {
            names: ["a", "b"],
            verb: "Exporting",
            progress: sink,
            processOne: async () => {},
            scanOne: async (_ctx, name) => name,
            hydrateOne: async (_ctx, name) => {
                if (name === "a") throw new Error("boom");
            },
        });
        expect(calls).toContain("failed:0:Error: boom");
        expect(calls).not.toContain("finished:0");
        expect(calls).toContain("finished:1");
    });

    it("counts successes and failures without aborting the batch", async () => {
        const { sink, calls } = fakeSink();
        const result = await runReadLoop(fakeCtx(), {
            names: ["a", "b", "c"],
            verb: "Exporting",
            progress: sink,
            processOne: async (_ctx, name) => {
                if (name === "b") throw new Error("boom");
            },
        });
        expect(result).toEqual({ succeeded: 2, failed: 1 });
        expect(calls).toContain("failed:1:Error: boom");
        expect(calls[calls.length - 1]).toBe("done");
    });

    it("rethrows cancellation, stops the batch, and still calls done()", async () => {
        const { sink, calls } = fakeSink();
        const processed: string[] = [];
        await expect(
            runReadLoop(fakeCtx(), {
                names: ["a", "b", "c"],
                verb: "Reading",
                progress: sink,
                processOne: async (_ctx, name) => {
                    processed.push(name);
                    if (name === "b") throw new Error("CANCELLED");
                },
            })
        ).rejects.toThrow("CANCELLED");
        expect(processed).toEqual(["a", "b"]);
        expect(calls.filter((c) => c.startsWith("failed"))).toEqual([]);
        expect(calls[calls.length - 1]).toBe("done");
    });

    it("binds itemProgress to the current item index", async () => {
        const progressIndexes: number[] = [];
        const sink: ExportProgressSink = {
            start: () => {},
            item: () => {},
            itemProgress: (index) => progressIndexes.push(index),
            itemFailed: () => {},
            done: () => {},
        };
        await runReadLoop(fakeCtx(), {
            names: ["a", "b"],
            verb: "Reading",
            progress: sink,
            processOne: async (_ctx, _name, onReadProgress) => {
                onReadProgress?.({
                    phase: "reading",
                    completedUnits: 1,
                    totalUnits: 2,
                    phaseUnits: { setup: 0, reading: 2, hydrating: 0, applying: 0 },
                    sync: { completedUnits: 1, totalUnits: 2, parent: null },
                });
            },
        });
        expect(progressIndexes).toEqual([0, 1]);
    });

    it("renders names through displayName in chat lines", async () => {
        const ctx = fakeCtx();
        await runReadLoop(ctx, {
            names: ["spawn"],
            verb: "Exporting",
            displayName: (name) => `/${name}`,
            processOne: async () => {},
        });
        expect(ctx.displayMessage).toHaveBeenCalledWith(
            "&7[1/1] &fExporting '/spawn'"
        );
    });
});
