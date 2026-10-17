import { afterEach, describe, expect, it, vi } from "vitest";
import { initStatusBridge, sampleBridgeProgress } from "../src/bridge/runtime";
import { HTSW_STATUS_PROPERTY } from "../src/bridge/types";

const progress = vi.hoisted(() => ({
    getTaskProgress: vi.fn(),
    getTaskProgressFraction: vi.fn(() => 0.5),
    getTaskEtaSeconds: vi.fn(() => 12),
    getSessionVerb: vi.fn(() => "import"),
    isEtaEstimating: vi.fn(() => false),
    isEtaRough: vi.fn(() => false),
}));
vi.mock("../src/gui/right-panel/import-tab/taskProgress", () => progress);

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe("bridge runtime", () => {
    it("uses the displayed total ETA readiness and rough/estimating flags", () => {
        progress.getTaskProgress.mockReturnValue({
            totalsLocked: false,
            active: { phase: "reading" },
        });
        expect(sampleBridgeProgress()).toMatchObject({
            etaSeconds: null,
            estimatedFinishAt: null,
            estimateState: "estimating",
        });
        expect(progress.getTaskEtaSeconds).not.toHaveBeenCalled();
        progress.getTaskProgress.mockReturnValue({
            totalsLocked: true,
            active: {
                phase: "applying",
                key: "function",
                type: "FUNCTION",
                identity: "main",
            },
        });
        expect(sampleBridgeProgress()).toMatchObject({
            etaSeconds: 12,
            estimateState: "ready",
            progressFraction: 0.5,
            currentImportable: { identity: "main" },
        });
        progress.isEtaRough.mockReturnValue(true);
        expect(sampleBridgeProgress().estimateState).toBe("rough");
        progress.isEtaEstimating.mockReturnValue(true);
        expect(sampleBridgeProgress()).toMatchObject({
            etaSeconds: null,
            estimateState: "estimating",
        });
    });

    it("writes JSON on initialization and idle steps, then clears the JVM property on unload", () => {
        const system = { setProperty: vi.fn<(key: string, value: string) => void>(), clearProperty: vi.fn<(key: string) => void>() };
        const callbacks = new Map<string, () => void>();
        const setFps = vi.fn();
        vi.stubGlobal("Java", { type: () => system });
        vi.stubGlobal("register", (type: string, callback: () => void) => {
            callbacks.set(type, callback);
            return { setFps };
        });
        initStatusBridge();
        expect(setFps).toHaveBeenCalledWith(4);
        expect(system.setProperty.mock.calls[0][0]).toBe(HTSW_STATUS_PROPERTY);
        expect(JSON.parse(system.setProperty.mock.calls[0][1])).toMatchObject({
            version: 1,
            run: null,
            events: [],
        });
        callbacks.get("step")!();
        expect(system.setProperty).toHaveBeenCalledTimes(2);
        callbacks.get("gameUnload")!();
        expect(system.clearProperty).toHaveBeenCalledWith(HTSW_STATUS_PROPERTY);
        callbacks.get("step")!();
        expect(system.setProperty).toHaveBeenCalledTimes(2);
    });
});
