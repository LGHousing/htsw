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
    const Thread = javaType("java.lang.Thread");
    const Runnable = javaType("java.lang.Runnable");
    try {
        const thread = new Thread(
            new Runnable({
                run: function () {
                    let parsed: ImportablesParseResult | null = null;
                    let error: string | null = null;
                    let fingerprint: { [path: string]: number } = {};
                    fingerprint[canonicalImportJsonPath] = importJsonMtime;
                    let hashes: string[] = [];
                    try {
                        const sourceMap = new SourceMap(new FileSystemFileLoader());
                        parsed = parseImportablesResult(
                            sourceMap,
                            canonicalImportJsonPath
                        );
                        fingerprint = buildParseFingerprint(
                            canonicalImportJsonPath,
                            importJsonMtime,
                            parsed
                        );
                        hashes = parsed.value.map(importableHash);
                        saveSnapshot(
                            canonicalImportJsonPath,
                            parsed,
                            fingerprint,
                            hashes
                        );
                    } catch (parseError) {
                        parsed = null;
                        hashes = [];
                        error =
                            parseError &&
                            (parseError as { message?: string }).message
                                ? (parseError as { message: string }).message
                                : String(parseError);
                    }
                    const result = { parsed, error, fingerprint, hashes };
                    runOnMainThread(() => onComplete(result));
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
            })
        );
    }
}
