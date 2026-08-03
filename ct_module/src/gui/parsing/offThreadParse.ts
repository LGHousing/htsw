/// <reference types="../../../CTAutocomplete" />

import { ImportablesParseResult, parseImportablesResult, SourceMap } from "htsw";

import { importableHash } from "../../importCache/hash";
import { FileSystemFileLoader } from "../../utils/fileLoaders";
import { runOnMainThread } from "../../utils/mainThread";
import { getMtimeMs, javaType } from "../lib/java";
import { allReferencedPaths } from "./importablePaths";
import { saveSnapshot } from "./parseSnapshot";

export type OffThreadParseResult = {
    parsed: ImportablesParseResult | null;
    error: string | null;
    fingerprint: { [path: string]: number };
    hashes: string[];
    profile: OffThreadParseProfile | null;
};

export type ParsePhaseTimings = {
    sourceParseMs: number;
    referencedPathFingerprintMs: number;
    importableHashMs: number;
    snapshotBuildMs: number;
    snapshotSerializeMs: number;
    snapshotWriteMs: number;
};

type ParseProjectShape = {
    referencedPathCount: number;
    importableCount: number;
    diagnosticCount: number;
    snapshotBytes: number | null;
};

export type OffThreadParseProfile = {
    phases: ParsePhaseTimings;
    projectShape: ParseProjectShape | null;
    workerStartDelayMs: number | null;
    mainThreadCallbackDelayMs: number | null;
};

export function buildParseFingerprint(
    importJsonPath: string,
    importJsonMtime: number,
    parsed: ImportablesParseResult
): { [path: string]: number } {
    const fingerprint: { [path: string]: number } = {};
    fingerprint[importJsonPath] = importJsonMtime;
    const paths = allReferencedPaths(importJsonPath, parsed);
    for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        if (!Object.prototype.hasOwnProperty.call(fingerprint, path)) {
            fingerprint[path] = getMtimeMs(path);
        }
    }
    return fingerprint;
}

/**
 * The caller must canonicalize paths and warm filesystem statics before entry.
 * The worker owns only local values; shared caches and promise settlement belong
 * in `onComplete`, which always runs on the main client thread.
 */
export function parseImportJsonOffThread(
    canonicalImportJsonPath: string,
    importJsonMtime: number,
    onComplete: (result: OffThreadParseResult) => void
): void {
    const submittedAt = Date.now();
    const Thread = javaType("java.lang.Thread");
    const Runnable = javaType("java.lang.Runnable");
    try {
        const thread = new Thread(
            new Runnable({
                run: function () {
                    const workerStartedAt = Date.now();
                    let parsed: ImportablesParseResult | null = null;
                    let error: string | null = null;
                    let fingerprint: { [path: string]: number } = {};
                    fingerprint[canonicalImportJsonPath] = importJsonMtime;
                    let hashes: string[] = [];
                    const phases: ParsePhaseTimings = {
                        sourceParseMs: 0,
                        referencedPathFingerprintMs: 0,
                        importableHashMs: 0,
                        snapshotBuildMs: 0,
                        snapshotSerializeMs: 0,
                        snapshotWriteMs: 0,
                    };
                    let projectShape: ParseProjectShape | null = null;
                    try {
                        const sourceParseStartedAt = Date.now();
                        try {
                            const sourceMap = new SourceMap(
                                new FileSystemFileLoader()
                            );
                            parsed = parseImportablesResult(
                                sourceMap,
                                canonicalImportJsonPath
                            );
                        } finally {
                            phases.sourceParseMs = Date.now() - sourceParseStartedAt;
                        }
                        const fingerprintStartedAt = Date.now();
                        fingerprint = buildParseFingerprint(
                            canonicalImportJsonPath,
                            importJsonMtime,
                            parsed
                        );
                        phases.referencedPathFingerprintMs =
                            Date.now() - fingerprintStartedAt;
                        const hashStartedAt = Date.now();
                        hashes = parsed.value.map(importableHash);
                        phases.importableHashMs = Date.now() - hashStartedAt;
                        const snapshotMetrics = saveSnapshot(
                            canonicalImportJsonPath,
                            parsed,
                            fingerprint,
                            hashes
                        );
                        phases.snapshotBuildMs = snapshotMetrics.buildMs;
                        phases.snapshotSerializeMs = snapshotMetrics.serializeMs;
                        phases.snapshotWriteMs = snapshotMetrics.writeMs;
                        projectShape = {
                            referencedPathCount: Object.keys(fingerprint).length,
                            importableCount: parsed.value.length,
                            diagnosticCount: parsed.diagnostics.length,
                            snapshotBytes: snapshotMetrics.bytes,
                        };
                    } catch (parseError) {
                        parsed = null;
                        hashes = [];
                        error =
                            parseError &&
                            (parseError as { message?: string }).message
                                ? (parseError as { message: string }).message
                                : String(parseError);
                    }
                    const workerFinishedAt = Date.now();
                    const profile: OffThreadParseProfile = {
                        phases,
                        projectShape,
                        workerStartDelayMs: workerStartedAt - submittedAt,
                        mainThreadCallbackDelayMs: 0,
                    };
                    const result = { parsed, error, fingerprint, hashes, profile };
                    runOnMainThread(() => {
                        result.profile.mainThreadCallbackDelayMs =
                            Date.now() - workerFinishedAt;
                        onComplete(result);
                    });
                },
            })
        );
        thread.setDaemon(true);
        thread.start();
    } catch (threadError) {
        const error =
            threadError && (threadError as { message?: string }).message
                ? (threadError as { message: string }).message
                : String(threadError);
        runOnMainThread(() =>
            onComplete({
                parsed: null,
                error,
                fingerprint: { [canonicalImportJsonPath]: importJsonMtime },
                hashes: [],
                profile: null,
            })
        );
    }
}
