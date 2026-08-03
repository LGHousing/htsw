import {
    guiCacheSizes,
    parsedManifestCount,
    type GuiCacheSizes,
} from "../gui/cacheTelemetry";
import { readLocalVersion } from "../autoUpdate";
import { getUploadSessionHeartbeat } from "../settings";
import { TaskManager } from "../tasks/manager";
import { ensureParentDirs } from "../utils/filesystem";
import { javaType } from "../utils/java";
import { uploadDiagnosticsFile } from "./importFailureUpload";
import { runtimeDebugStats } from "./runtimeDebugBuffer";

const HEARTBEAT_INTERVAL_SECONDS = 30 * 60;
const HEARTBEAT_PATH = "./htsw/import-errors/session-heartbeat.json";
const SESSION_HEARTBEAT_KIND = 1;
const SESSION_HEARTBEAT_SCHEMA_VERSION = 2;
const startedAt = Date.now();
const sessionId = randomSessionId();

type GarbageCollectorTelemetry = {
    name: string;
    collectionCount: number;
    collectionTimeMs: number;
};

type JvmMemoryTelemetry = {
    javaVersion: string;
    heapUsedBytes: number;
    heapCommittedBytes: number;
    heapMaxBytes: number;
    nonHeapUsedBytes: number;
    gcCollectionCount: number;
    gcCollectionTimeMs: number;
    garbageCollectors: GarbageCollectorTelemetry[];
};

export type SessionHeartbeatBody = JvmMemoryTelemetry &
    GuiCacheSizes & {
        kind: number;
        schemaVersion: number;
        capturedAtMs: number;
        sessionUptimeMs: number;
        sessionId: string;
        htswVersion: string;
        taskRunning: boolean;
        runtimeDebug: Record<string, unknown>;
        parsedManifestCount: number;
    };

function randomSessionId(): string {
    let id = "";
    for (let i = 0; i < 32; i++) {
        id += Math.floor(Math.random() * 16).toString(16);
    }
    return id;
}

function sumSupported(
    collectors: GarbageCollectorTelemetry[],
    field: "collectionCount" | "collectionTimeMs"
): number {
    let total = 0;
    let supported = false;
    for (let i = 0; i < collectors.length; i++) {
        const value = collectors[i][field];
        if (value < 0) continue;
        total += value;
        supported = true;
    }
    return supported ? total : -1;
}

function readJvmMemoryTelemetry(): JvmMemoryTelemetry {
    const runtime = javaType("java.lang.Runtime").getRuntime();
    const heapCommittedBytes = Number(runtime.totalMemory());
    const ManagementFactory = javaType("java.lang.management.ManagementFactory");
    const nonHeap = ManagementFactory.getMemoryMXBean().getNonHeapMemoryUsage();
    const beans = ManagementFactory.getGarbageCollectorMXBeans();
    const garbageCollectors: GarbageCollectorTelemetry[] = [];
    for (let i = 0; i < beans.length; i++) {
        const bean = beans[i];
        garbageCollectors.push({
            name: String(bean.getName()),
            collectionCount: Number(bean.getCollectionCount()),
            collectionTimeMs: Number(bean.getCollectionTime()),
        });
    }
    return {
        javaVersion: String(javaType("java.lang.System").getProperty("java.version")),
        heapUsedBytes: heapCommittedBytes - Number(runtime.freeMemory()),
        heapCommittedBytes,
        heapMaxBytes: Number(runtime.maxMemory()),
        nonHeapUsedBytes: Number(nonHeap.getUsed()),
        gcCollectionCount: sumSupported(garbageCollectors, "collectionCount"),
        gcCollectionTimeMs: sumSupported(garbageCollectors, "collectionTimeMs"),
        garbageCollectors,
    };
}

export function createSessionHeartbeatBody(
    capturedAtMs: number = Date.now()
): SessionHeartbeatBody {
    return {
        kind: SESSION_HEARTBEAT_KIND,
        schemaVersion: SESSION_HEARTBEAT_SCHEMA_VERSION,
        capturedAtMs,
        sessionUptimeMs: Math.max(0, capturedAtMs - startedAt),
        sessionId,
        htswVersion: readLocalVersion() ?? "unknown",
        taskRunning: TaskManager.isBusy(),
        ...readJvmMemoryTelemetry(),
        runtimeDebug: runtimeDebugStats(),
        ...guiCacheSizes(),
        parsedManifestCount: parsedManifestCount(),
    };
}

function uploadSessionHeartbeat(): void {
    try {
        if (!getUploadSessionHeartbeat()) return;
        const body = createSessionHeartbeatBody();
        ensureParentDirs(HEARTBEAT_PATH);
        FileLib.write(HEARTBEAT_PATH, JSON.stringify(body), true);
        uploadDiagnosticsFile(HEARTBEAT_PATH);
    } catch (_e) {}
}

let initialized = false;

export function initSessionHeartbeat(): void {
    if (initialized) return;
    initialized = true;
    register("step", uploadSessionHeartbeat).setDelay(HEARTBEAT_INTERVAL_SECONDS);
}
