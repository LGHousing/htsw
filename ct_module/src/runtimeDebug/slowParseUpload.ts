import { getUploadSlowParseDiagnostics } from "../settings";
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
        const body = {
            kind: "slow-parse",
            capturedAt: new Date().toISOString(),
            project: details.canon,
            durationMs: details.durationMs,
            parseSource: details.source,
            reason: details.reason,
            changedPaths: details.changedPaths,
            parsePerf: details.parsePerf,
            recentRuntimeDebug: recentRuntimeDebugRecords(),
        };
        ensureParentDirs(path);
        FileLib.write(path, JSON.stringify(body, null, 2), true);
        uploadDiagnosticsFile(path);
    } catch (_e) {}
}
