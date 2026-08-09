import { afterEach, describe, expect, test, vi } from "vitest";

const cacheSizes = vi.hoisted(() => ({
    unboundedParses: 1,
    boundedCanonicalPaths: 2,
    boundedLinePlain: 3,
    boundedLineHtsl: 4,
    boundedLineJson: 5,
    boundedLineSnbt: 6,
    boundedLineHtslRaw: 7,
    boundedProjectEnumeration: 8,
    boundedSubtreeAggregates: 9,
    boundedLivePreviews: 10,
    boundedLivePreviewLines: 101,
    boundedLivePreviewTokens: 202,
    boundedLivePreviewPendingNodes: 3,
    boundedTextWidths: 11,
    boundedTruncations: 12,
    boundedHtslParses: 13,
    unboundedMcItems: 14,
    unboundedIcons: 15,
    unboundedAnchors: 16,
    unboundedCodeViewModels: 17,
    unboundedSourceDiffEntries: 18,
    unboundedSourceDiffFileTargets: 19,
    unboundedRightPanelFiles: 20,
    unboundedQueueItems: 21,
    unboundedQueueSourceIndexes: 22,
    unboundedQueueSkipPredictions: 23,
    unboundedImportCacheReads: 24,
    unboundedImportCacheEnumerations: 25,
    unboundedImportCacheScanMarkers: 26,
    unboundedCanonicalDefaults: 27,
    unboundedFocusedLines: 28,
}));
const uploadDiagnosticsFile = vi.hoisted(() => vi.fn());
const ensureParentDirs = vi.hoisted(() => vi.fn());
const taskRunning = vi.hoisted(() => ({ value: true }));
const runtimeDebug = vi.hoisted(() => ({
    maxRecords: 1_000,
    retainedRecords: 20,
    droppedRecords: 3,
    startedAt: 900,
}));

vi.mock("../src/gui/cacheTelemetry", () => ({
    guiCacheSizes: () => cacheSizes,
    parsedManifestCount: () => 6,
}));
vi.mock("../src/settings", () => ({
    getUploadDiagnostics: () => true,
}));
vi.mock("../src/autoUpdate", () => ({
    readLocalVersion: () => "0.13.0-test.4",
}));
vi.mock("../src/tasks/manager", () => ({
    TaskManager: { isBusy: () => taskRunning.value },
}));
vi.mock("../src/utils/filesystem", () => ({ ensureParentDirs }));
vi.mock("../src/runtimeDebug/importFailureUpload", () => ({
    uploadDiagnosticsFile,
}));
vi.mock("../src/runtimeDebug/runtimeDebugBuffer", () => ({
    runtimeDebugStats: () => runtimeDebug,
}));

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    uploadDiagnosticsFile.mockReset();
    ensureParentDirs.mockReset();
});

function stubJvmMetrics(): void {
    vi.stubGlobal("Java", {
        type: (name: string) => {
            if (name === "java.lang.Runtime") {
                return {
                    getRuntime: () => ({
                        totalMemory: () => 300,
                        freeMemory: () => 80,
                        maxMemory: () => 500,
                    }),
                };
            }
            if (name === "java.lang.management.ManagementFactory") {
                return {
                    getMemoryMXBean: () => ({
                        getNonHeapMemoryUsage: () => ({ getUsed: () => 70 }),
                    }),
                    getGarbageCollectorMXBeans: () => [
                        {
                            getName: () => "PS Scavenge",
                            getCollectionCount: () => 12,
                            getCollectionTime: () => 34,
                        },
                        {
                            getName: () => "PS MarkSweep",
                            getCollectionCount: () => 2,
                            getCollectionTime: () => 9,
                        },
                    ],
                };
            }
            if (name === "java.lang.System") {
                return { getProperty: () => "1.8.0_51" };
            }
            throw new Error(`Unexpected Java type: ${name}`);
        },
    });
}

describe("session heartbeat", () => {
    test("includes build, JVM, task, debug, and cache context", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        vi.resetModules();
        stubJvmMetrics();
        const { createSessionHeartbeatBody } =
            await import("../src/runtimeDebug/sessionHeartbeat");

        const body = createSessionHeartbeatBody(2_500);

        expect(body.sessionId).toMatch(/^[0-9a-f]{32}$/);
        expect(body).toEqual({
            kind: 1,
            schemaVersion: 2,
            capturedAtMs: 2_500,
            sessionUptimeMs: 1_500,
            sessionId: body.sessionId,
            htswVersion: "0.13.0-test.4",
            taskRunning: true,
            javaVersion: "1.8.0_51",
            heapUsedBytes: 220,
            heapCommittedBytes: 300,
            heapMaxBytes: 500,
            nonHeapUsedBytes: 70,
            gcCollectionCount: 14,
            gcCollectionTimeMs: 43,
            garbageCollectors: [
                {
                    name: "PS Scavenge",
                    collectionCount: 12,
                    collectionTimeMs: 34,
                },
                {
                    name: "PS MarkSweep",
                    collectionCount: 2,
                    collectionTimeMs: 9,
                },
            ],
            runtimeDebug,
            ...cacheSizes,
            parsedManifestCount: 6,
        });
        expect(Object.keys(cacheSizes)).toHaveLength(31);
    });

    test("uses one ephemeral id for the loaded session", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        vi.resetModules();
        stubJvmMetrics();
        const { createSessionHeartbeatBody } =
            await import("../src/runtimeDebug/sessionHeartbeat");

        const first = createSessionHeartbeatBody(2_500);
        const second = createSessionHeartbeatBody(3_500);

        expect(second.sessionId).toBe(first.sessionId);
        expect(second.sessionUptimeMs).toBe(2_500);
    });

    test("schedules and uploads one compact heartbeat every 30 minutes", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(10_000);
        vi.resetModules();
        stubJvmMetrics();
        const write = vi.fn();
        vi.stubGlobal("FileLib", { write });
        const registered: { callback: (() => void) | null } = { callback: null };
        const setDelay = vi.fn();
        vi.stubGlobal(
            "register",
            vi.fn((_event: string, registeredCallback: () => void) => {
                registered.callback = registeredCallback;
                return { setDelay };
            })
        );
        const { initSessionHeartbeat } =
            await import("../src/runtimeDebug/sessionHeartbeat");

        initSessionHeartbeat();
        expect(setDelay).toHaveBeenCalledWith(1_800);
        expect(registered.callback).not.toBeNull();
        registered.callback?.();

        expect(write).toHaveBeenCalledOnce();
        const [path, rawBody, overwrite] = write.mock.calls[0] as unknown as [
            string,
            string,
            boolean,
        ];
        expect(path).toBe("./htsw/import-errors/session-heartbeat.json");
        expect(rawBody).toBe(JSON.stringify(JSON.parse(rawBody)));
        expect(overwrite).toBe(true);
        expect(uploadDiagnosticsFile).toHaveBeenCalledWith(path);
    });
});
