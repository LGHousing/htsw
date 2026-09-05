import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HtswBridgeSnapshot } from "../src/bridge/types";

describe("structured HTSW bridge", () => {
    beforeEach(() => vi.resetModules());

    it("retains a whole queue run through sessions and snapshots short-lived transitions", async () => {
        const bridge = await import("../src/bridge/status");
        let json = "";
        bridge.connectBridge(
            (value) => {
                json = value;
            },
            () => ({})
        );
        bridge.beginBridgeRun("import", "queue");
        const runId = bridge.bridgeStatus().run!.runId;
        bridge.beginBridgeSession("import");
        const firstSession = bridge.bridgeStatus().run!.sessionId;
        bridge.finishBridgeSession("completed", { imported: 2 });
        expect(bridge.bridgeStatus().run!.state).toBe("running");
        bridge.beginBridgeSession("read");
        expect(bridge.bridgeStatus().run!.sessionId).not.toBe(firstSession);
        expect(bridge.bridgeStatus().run!.runId).toBe(runId);
        bridge.finishBridgeSession("completed", { count: 3 });
        bridge.finishBridgeRun("completed", { completed: 5 });
        const finished = JSON.parse(json) as HtswBridgeSnapshot;
        const runEvents = finished.events.filter((event) => event.type === "htsw_run");
        expect(runEvents.map((event) => event.data.phase)).toEqual([
            "started",
            "finished",
        ]);
        expect(runEvents[0].data.run).toMatchObject({
            state: "running",
            sessionId: null,
        });
        expect(runEvents[1].data.run).toMatchObject({
            runId,
            state: "completed",
            operation: "read",
            completed: 5,
        });
        bridge.beginBridgeRun("diff", "task");
        expect(
            bridge
                .bridgeSnapshot()
                .events.find((event) => event.sequence === runEvents[1].sequence)!.data
                .run
        ).toMatchObject({ runId, state: "completed" });
    });

    it("publishes prompts immediately with conflicts, and withholds finish times until answered", async () => {
        const bridge = await import("../src/bridge/status");
        let json = "";
        bridge.connectBridge(
            (value) => {
                json = value;
            },
            () => ({ etaSeconds: 42, estimatedFinishAt: 42000, estimateState: "ready" })
        );
        bridge.beginBridgeRun("import", "queue");
        bridge.beginBridgeSession("import");
        bridge.setBridgeConflictDetails({
            conflicts: [{ type: "FUNCTION", identity: "main", basePath: "actions" }],
            diffPath: "/tmp/diff.txt",
        });
        bridge.openBridgePrompt({
            promptId: "prompt-1",
            confirmAction: "import anyway",
            refuseAction: "cancel",
            answerYesCommand: "/htsw answer prompt-1 yes",
            answerNoCommand: "/htsw answer prompt-1 no",
        });
        const waiting = JSON.parse(json) as HtswBridgeSnapshot;
        expect(waiting.run).toMatchObject({
            state: "waiting_for_input",
            etaSeconds: null,
            estimatedFinishAt: null,
            estimateState: "unavailable",
        });
        expect(waiting.events[waiting.events.length - 1]?.data).toMatchObject({
            phase: "waiting_for_input",
            promptId: "prompt-1",
            diffPath: "/tmp/diff.txt",
        });
        bridge.closeBridgePrompt("prompt-1");
        expect(bridge.bridgeStatus().run).toMatchObject({
            state: "running",
            etaSeconds: 42,
            prompt: null,
        });
        bridge.finishBridgeRun("paused");
        const terminal = JSON.parse(json) as HtswBridgeSnapshot;
        bridge.publishBridgeStatus();
        expect((JSON.parse(json) as HtswBridgeSnapshot).run).toEqual(terminal.run);
        expect(terminal.run).toMatchObject({
            state: "paused",
            etaSeconds: null,
            estimatedFinishAt: null,
        });
    });

    it("rejects concurrent starts without replacing or terminating the active invocation", async () => {
        const bridge = await import("../src/bridge/status");
        bridge.beginBridgeRun("export", "queue");
        const activeId = bridge.bridgeStatus().run!.runId;
        bridge.rejectBridgeRun("import", "busy");
        const snapshot = bridge.bridgeSnapshot();
        expect(snapshot.run).toMatchObject({ runId: activeId, state: "running" });
        const rejection = snapshot.events[snapshot.events.length - 1];
        expect(rejection.type).toBe("htsw_run");
        expect(rejection.data.runId).not.toBe(activeId);
        expect(rejection.data).toMatchObject({
            phase: "rejected",
            reason: "busy",
            run: { state: "failed", reason: "busy" },
        });
        bridge.finishBridgeRun("failed", { reason: "menu did not open", failed: 1 });
        expect(bridge.bridgeStatus().run).toMatchObject({
            runId: activeId,
            state: "failed",
            reason: "menu did not open",
            failed: 1,
        });
    });

    it("keeps setting and cache diagnostics independent of an active import", async () => {
        const bridge = await import("../src/bridge/status");
        bridge.beginBridgeRun("import", "queue");
        bridge.beginBridgeSession("import");
        const activeId = bridge.bridgeStatus().run!.runId;
        const diagnosticIds: string[] = [];
        for (const type of ["htsw_setting", "htsw_cache_report"] as const) {
            bridge.emitBridgeEvent(type, { status: "completed" });
            const events = bridge.bridgeSnapshot().events;
            const data = events[events.length - 1].data;
            expect(data.runId).not.toBe(activeId);
            expect(data.sessionId).toBeNull();
            expect(data.op).toBeUndefined();
            diagnosticIds.push(data.runId);
        }
        expect(diagnosticIds[0]).not.toBe(diagnosticIds[1]);
        expect(bridge.bridgeStatus().run).toMatchObject({
            runId: activeId,
            state: "running",
        });
        bridge.emitBridgeEvent("htsw_plan", { status: "completed" });
        const events = bridge.bridgeSnapshot().events;
        expect(events[events.length - 1].data).toMatchObject({
            runId: activeId,
            op: "import",
        });
    });

    it("bounds the ring, advances idle heartbeats, and stops publishing after disconnect", async () => {
        const bridge = await import("../src/bridge/status");
        const writer = vi.fn<(json: string) => void>();
        bridge.connectBridge(writer, () => ({}));
        const before = bridge.bridgeStatus().updatedAt!;
        const now = vi.spyOn(Date, "now").mockReturnValue(before + 250);
        bridge.publishBridgeStatus();
        expect(
            JSON.parse(writer.mock.calls[writer.mock.calls.length - 1][0])
        ).toMatchObject({ updatedAt: before + 250, run: null });
        for (let i = 0; i < 300; i++)
            bridge.emitBridgeEvent("htsw_diff", { status: "details", path: String(i) });
        const snapshot = bridge.bridgeSnapshot();
        expect(snapshot.events).toHaveLength(256);
        expect(snapshot.events[0].sequence).toBe(45);
        expect(snapshot.events[snapshot.events.length - 1].sequence).toBe(300);
        bridge.disconnectBridge();
        writer.mockClear();
        bridge.publishBridgeStatus();
        expect(writer).not.toHaveBeenCalled();
        now.mockRestore();
    });
});
