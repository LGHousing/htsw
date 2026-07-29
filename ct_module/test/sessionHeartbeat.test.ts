import { afterEach, describe, expect, test, vi } from "vitest";

const cacheSizes = vi.hoisted(() => ({
    boundedParses: 1,
    boundedCanonicalPaths: 2,
    boundedLinePlain: 3,
    boundedLineHtsl: 4,
    boundedLineJson: 5,
    boundedLineSnbt: 6,
    boundedLineHtslRaw: 7,
    boundedProjectEnumeration: 8,
    boundedSubtreeAggregates: 9,
    boundedLivePreviews: 10,
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

vi.mock("../src/gui/cacheTelemetry", () => ({
    guiCacheSizes: () => cacheSizes,
    parsedManifestCount: () => 6,
}));
vi.mock("../src/settings", () => ({
    getUploadSessionHeartbeat: () => true,
}));
vi.mock("../src/utils/filesystem", () => ({ ensureParentDirs }));
vi.mock("../src/runtimeDebug/importFailureUpload", () => ({
    uploadDiagnosticsFile,
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
                            getName: () => "G1 Young Generation",
                            getCollectionCount: () => 12,
                            getCollectionTime: () => 34,
                        },
                        {
                            getName: () => "G1 Old Generation",
                            getCollectionCount: () => 2,
                            getCollectionTime: () => 9,
                        },
                    ],
                };
            }
            throw new Error(`Unexpected Java type: ${name}`);
        },
    });
}

describe("session heartbeat", () => {
    test("contains only numeric fields, including all 28 cache sizes", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        vi.resetModules();
        stubJvmMetrics();
        const { createSessionHeartbeatBody } = await import(
            "../src/runtimeDebug/sessionHeartbeat"
        );

        const body = createSessionHeartbeatBody(2_500);

        expect(body).toEqual({
            kind: 1,
            schemaVersion: 1,
            capturedAtMs: 2_500,
            sessionUptimeMs: 1_500,
            heapUsedBytes: 220,
            heapCommittedBytes: 300,
            heapMaxBytes: 500,
            nonHeapUsedBytes: 70,
            g1YoungCollectionCount: 12,
            g1YoungCollectionTimeMs: 34,
            g1OldCollectionCount: 2,
            g1OldCollectionTimeMs: 9,
            ...cacheSizes,
            parsedManifestCount: 6,
        });
        expect(Object.keys(cacheSizes)).toHaveLength(28);
        for (const key of Object.keys(body) as Array<keyof typeof body>) {
            const value = body[key];
            expect(typeof value).toBe("number");
            expect(Number.isFinite(value)).toBe(true);
            expect(Number.isInteger(value)).toBe(true);
        }
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
        const { initSessionHeartbeat } = await import(
            "../src/runtimeDebug/sessionHeartbeat"
        );

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
