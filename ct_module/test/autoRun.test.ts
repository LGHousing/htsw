import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
    enabled: true,
    rows: [] as Array<{ key: string; op: string; status: string }>,
    restored: new Set<string>(),
    running: false,
    starts: [] as Array<{ autoRun?: boolean } | undefined>,
    cancelled: 0,
    writes: [] as string[],
    runEnded: null as null | ((state: "idle" | "running" | "paused") => void),
}));

vi.mock("../src/settings", () => ({
    getAutoRun: () => state.enabled,
    setAutoRun: (enabled: boolean) => {
        state.enabled = enabled;
    },
}));
vi.mock("../src/gui/right-panel/import-tab/queue", () => ({
    getQueue: () => state.rows,
    getQueueRow: (key: string) => state.rows.find((row) => row.key === key) ?? null,
    isRestoredQueueRow: (key: string) => state.restored.has(key),
}));
vi.mock("../src/gui/right-panel/import-tab/queueRunner", () => ({
    isQueueRunning: () => state.running,
    startQueue: (options?: { autoRun?: boolean }) => {
        state.starts.push(options);
        state.running = true;
        return true;
    },
    onQueueRunEnded: (listener: (runState: "idle" | "running" | "paused") => void) => {
        state.runEnded = listener;
        return () => {};
    },
}));
vi.mock("../src/gui/badge", () => ({ registerBadge: () => {} }));
vi.mock("../src/gui/toast", () => ({ dismissToast: () => {}, showToast: () => {} }));
vi.mock("../src/tasks/activeTask", () => ({
    cancelActiveTask: () => {
        state.cancelled++;
        return true;
    },
}));
vi.mock("../src/utils/filesystem", () => ({ ensureParentDirs: () => {} }));

describe("queue Auto-run safeguards", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.useFakeTimers();
        state.enabled = true;
        state.rows = [{ key: "k", op: "import", status: "queued" }];
        state.restored.clear();
        state.running = false;
        state.starts = [];
        state.cancelled = 0;
        state.writes = [];
        state.runEnded = null;
        vi.stubGlobal("Server", { getIP: () => "mc.hypixel.net" });
        vi.stubGlobal("ChatLib", { chat: () => {} });
        vi.stubGlobal("FileLib", {
            write: (path: string) => state.writes.push(path),
        });
    });

    test("starts two seconds after the last queue change", async () => {
        const { autoRunQueueChanged } = await import("../src/gui/autoRun");

        autoRunQueueChanged();
        await vi.advanceTimersByTimeAsync(1000);
        autoRunQueueChanged();
        await vi.advanceTimersByTimeAsync(1999);
        expect(state.starts).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);

        expect(state.starts).toEqual([{ autoRun: true }]);
    });

    test("does not start for restored rows", async () => {
        state.restored.add("k");
        const { autoRunQueueChanged } = await import("../src/gui/autoRun");

        autoRunQueueChanged();
        await vi.advanceTimersByTimeAsync(2000);

        expect(state.starts).toEqual([]);
    });

    test("parse-error hold clears only on a reparse", async () => {
        const { autoRunQueueChanged, autoRunRefresh, holdAutoRunUntilReparse } =
            await import("../src/gui/autoRun");

        holdAutoRunUntilReparse();
        autoRunQueueChanged();
        await vi.advanceTimersByTimeAsync(2000);
        expect(state.starts).toEqual([]);

        autoRunRefresh("cacheWarm", 1, 1, ["k"], new Set());
        await vi.advanceTimersByTimeAsync(2000);
        expect(state.starts).toEqual([]);

        autoRunRefresh("reparse", 0, 0, ["k"], new Set());
        await vi.advanceTimersByTimeAsync(2000);
        expect(state.starts).toEqual([{ autoRun: true }]);
    });

    test("a reparse that changes running work cancels its session", async () => {
        const { autoRunQueueChanged, autoRunRefresh } =
            await import("../src/gui/autoRun");
        autoRunQueueChanged();
        await vi.advanceTimersByTimeAsync(2000);
        state.rows[0].status = "running";

        autoRunRefresh("reparse", 1, 1, ["k"], new Set());

        expect(state.cancelled).toBe(1);
    });

    test("does not cancel for a changed importable outside the running session", async () => {
        const { autoRunQueueChanged, autoRunRefresh } =
            await import("../src/gui/autoRun");
        autoRunQueueChanged();
        await vi.advanceTimersByTimeAsync(2000);
        state.rows[0].status = "running";

        autoRunRefresh("reparse", 1, 1, ["another-key"], new Set());

        expect(state.cancelled).toBe(0);
    });

    test("debounces another run after the queue runner settles", async () => {
        const { autoRunQueueChanged } = await import("../src/gui/autoRun");
        autoRunQueueChanged();
        await vi.advanceTimersByTimeAsync(2000);
        expect(state.starts).toHaveLength(1);

        state.running = false;
        state.rows[0].status = "queued";
        state.runEnded?.("paused");
        await vi.advanceTimersByTimeAsync(2000);

        expect(state.starts).toHaveLength(2);
    });

    test("disables Auto-run when completed imports immediately reappear", async () => {
        const { autoRunQueueChanged, autoRunRefresh } =
            await import("../src/gui/autoRun");
        autoRunQueueChanged();
        await vi.advanceTimersByTimeAsync(2000);
        state.running = false;
        state.rows = [];
        await vi.advanceTimersByTimeAsync(1700);

        autoRunRefresh("cacheWarm", 1, 1, ["k"], new Set());

        expect(state.enabled).toBe(false);
        expect(state.writes).toHaveLength(1);
        expect(state.writes[0]).toContain("auto-run-loop-");
    });
});
