import { getUploadSlowParseDiagnostics } from "../settings";
import { cyrb53 } from "../utils/helpers";
import { ensureParentDirs } from "../utils/filesystem";
import { recentRuntimeDebugRecords } from "./runtimeDebugBuffer";
import { uploadDiagnosticsFile } from "./importFailureUpload";

export type SlowParseDetails = {
    canon: string;
    durationMs: number;
    source: string;
    reason: string;
    changedPaths: readonly string[];
    parsePerf: readonly unknown[];
};

const uploadedProjects = new Set<string>();

function timestampForPath(): string {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

function containsAbsolutePath(value: string): boolean {
    const normalized = value.split("\\").join("/");
    return (
        /file:\/+/i.test(normalized) ||
        /(^|[\s("'=:])(?:\/\/[^/]|\/(?!\/)|[A-Za-z]:\/)/.test(normalized)
    );
}

function redactAbsolutePaths(value: unknown): unknown {
    if (typeof value === "string") {
        return containsAbsolutePath(value)
            ? `path:${cyrb53(value).toString(16)}`
            : value;
    }
    if (Array.isArray(value)) return value.map(redactAbsolutePaths);
    if (value === null || typeof value !== "object") return value;

    const redacted: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
        const redactedKey = containsAbsolutePath(key)
            ? `path:${cyrb53(key).toString(16)}`
            : key;
        redacted[redactedKey] = redactAbsolutePaths(
            (value as Record<string, unknown>)[key]
        );
    }
    return redacted;
}

export function uploadSlowParseDiagnostics(details: SlowParseDetails): void {
    try {
        if (
            !getUploadSlowParseDiagnostics() ||
            uploadedProjects.has(details.canon)
        ) {
            return;
        }
        uploadedProjects.add(details.canon);
        const path = `./htsw/import-errors/slow-parse-${timestampForPath()}.json`;
        const body = redactAbsolutePaths({
            kind: "slow-parse",
            capturedAt: new Date().toISOString(),
            project: details.canon,
            durationMs: details.durationMs,
            parseSource: details.source,
            reason: details.reason,
            changedPaths: details.changedPaths,
            parsePerf: details.parsePerf,
            recentRuntimeDebug: recentRuntimeDebugRecords(),
        });
        ensureParentDirs(path);
        FileLib.write(path, JSON.stringify(body, null, 2), true);
        uploadDiagnosticsFile(path);
    } catch (_e) {}
}
