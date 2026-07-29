import {
    guiCacheSizes,
    parsedManifestCount,
    type GuiCacheSizes,
} from "../gui/cacheTelemetry";
import { getUploadSessionHeartbeat } from "../settings";
import { ensureParentDirs } from "../utils/filesystem";
import { javaType } from "../utils/java";
import { uploadDiagnosticsFile } from "./importFailureUpload";

const HEARTBEAT_INTERVAL_SECONDS = 30 * 60;
const HEARTBEAT_PATH = "./htsw/import-errors/session-heartbeat.json";
const SESSION_HEARTBEAT_KIND = 1;
const SESSION_HEARTBEAT_SCHEMA_VERSION = 1;
const startedAt = Date.now();

type JvmMemoryTelemetry = {
    heapUsedBytes: number;
    heapCommittedBytes: number;
    heapMaxBytes: number;
    nonHeapUsedBytes: number;
    g1YoungCollectionCount: number;
    g1YoungCollectionTimeMs: number;
    g1OldCollectionCount: number;
    g1OldCollectionTimeMs: number;
};

export type SessionHeartbeatBody = JvmMemoryTelemetry &
    GuiCacheSizes & {
        kind: number;
        schemaVersion: number;
        capturedAtMs: number;
        sessionUptimeMs: number;
        parsedManifestCount: number;
    };

function readJvmMemoryTelemetry(): JvmMemoryTelemetry {
    const runtime = javaType("java.lang.Runtime").getRuntime();
    const heapCommittedBytes = Number(runtime.totalMemory());
    const ManagementFactory = javaType("java.lang.management.ManagementFactory");
    const nonHeap = ManagementFactory.getMemoryMXBean().getNonHeapMemoryUsage();
    let g1YoungCollectionCount = -1;
    let g1YoungCollectionTimeMs = -1;
    let g1OldCollectionCount = -1;
    let g1OldCollectionTimeMs = -1;
    const beans = ManagementFactory.getGarbageCollectorMXBeans();
    for (let i = 0; i < beans.length; i++) {
        const bean = beans[i];
        const name = String(bean.getName());
        if (name === "G1 Young Generation") {
            g1YoungCollectionCount = Number(bean.getCollectionCount());
            g1YoungCollectionTimeMs = Number(bean.getCollectionTime());
        } else if (name === "G1 Old Generation") {
            g1OldCollectionCount = Number(bean.getCollectionCount());
            g1OldCollectionTimeMs = Number(bean.getCollectionTime());
        }
    }
    return {
        heapUsedBytes: heapCommittedBytes - Number(runtime.freeMemory()),
        heapCommittedBytes,
        heapMaxBytes: Number(runtime.maxMemory()),
        nonHeapUsedBytes: Number(nonHeap.getUsed()),
        g1YoungCollectionCount,
        g1YoungCollectionTimeMs,
        g1OldCollectionCount,
        g1OldCollectionTimeMs,
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
        ...readJvmMemoryTelemetry(),
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
