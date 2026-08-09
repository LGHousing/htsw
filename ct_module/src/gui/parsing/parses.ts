/// <reference types="../../../CTAutocomplete" />

import { ImportablesParseResult, parseImportablesResult, SourceMap } from "htsw";

import { FileSystemFileLoader } from "../../utils/fileLoaders";
import {
    createProjectItemIndex,
    invalidateProjectItemIndex,
} from "../../importables/items/projectItems";
import {
    createItemDependencyIndex,
    invalidateItemDependencyIndex,
} from "../../importables/items/dependencyIndex";
import { recordHouseBinding } from "../../importCache/houseBindings";
import { getMtimeMs, javaType } from "../lib/java";
import {
    diffSnapshotFingerprint,
    loadSnapshot,
    restoreParseFromSnapshot,
    saveSnapshot,
} from "./parseSnapshot";
import {
    createFreshness,
    isFreshnessCheckDue,
    resetFreshness,
    settledChange,
    type FingerprintFreshness,
} from "./freshness";
import { markGuiDirty } from "../lib/dirty";
import { seedImportableHash } from "../../importCache/status";
import {
    buildParseFingerprint,
    parseImportJsonOffThread,
    type OffThreadParseProfile,
    type OffThreadParseResult,
    type ParsePhaseTimings,
} from "./offThreadParse";
import { uploadSlowParseDiagnostics } from "../../runtimeDebug/slowParseUpload";
import { BoundedMap } from "../lib/boundedLruMap";

/**
 * Per-file `import.json` parse cache. Lets the Projects tree show
 * importables from any number of import.jsons simultaneously, and lets
 * the dynamic queue resolve `QueueItem`s back to the parsed importable
 * objects regardless of which import.json they originated from.
 *
 * Cache is keyed by canonical absolute path (forward slashes, normalized)
 * so the same file referred to via two different relative paths shares a
 * single entry. Mtime-based staleness — a re-parse happens automatically
 * when the file changes on disk.
 */

export type CachedParse = {
    /** Absolute, forward-slashed, normalized path. Map key. */
    canonicalPath: string;
    /** Whatever string the caller originally handed us — kept for re-parse. */
    rawPath: string;
    /** `Files.getLastModifiedTime(...).toMillis()` at last parse. */
    mtime: number;
    parsed: ImportablesParseResult | null;
    /**
     * True when `parsed` was restored from a snapshot.
     * Diagnostics come back with real spans, but the AST `SpanTable` is
     * empty — action/field span lookups against it return nothing.
     */
    fromSnapshot: boolean;
    /** Non-null when the parse threw — e.g. malformed JSON. */
    error: string | null;
    /** mtime of the import.json and every file it referenced at parse time. */
    fingerprint: { [path: string]: number };
    /** Settle-debounce bookkeeping for the steady-state fingerprint poll. */
    freshness: FingerprintFreshness;
};

// `canonicalPath` is called all over the render paths (per file tab, per
// queue item, per importable in the cache scans) — and each call did a fresh
// `Java.type("java.nio.file.Paths")` lookup plus NIO path ops, which `java.ts`
// already warns is "not free". The result is a pure function of the input
// string (the process CWD is stable for the session), so memoize by input.
let _Paths: HtswJavaPathsClass | null = null;
const canonicalPathCache = new BoundedMap<string, string>(2048);

export function canonicalPath(p: string): string {
    if (!p) return p;
    const hit = canonicalPathCache.get(p);
    if (hit !== undefined) return hit;
    let result: string;
    try {
        if (_Paths === null) _Paths = javaType("java.nio.file.Paths");
        const abs = _Paths.get(p).toAbsolutePath();
        let resolved: HtswJavaPath;
        try {
            // The one identity function for paths: everything that compares,
            // caches, or dedups by path goes through here, and on Windows the
            // same file is reachable under differently-cased / relative /
            // absolute spellings (a `./htsw/...` open vs the absolute path in
            // housing-bindings.json once opened the same project as two
            // sources with two parse-cache entries). `toRealPath` collapses
            // every spelling of an existing file to the filesystem's own one.
            resolved = abs.toRealPath();
        } catch (_e) {
            // File doesn't exist (yet) — fall back to lexical normalization.
            resolved = abs.normalize();
        }
        result = String(resolved.toString()).split("\\").join("/");
    } catch (_e) {
        result = p.split("\\").join("/");
    }
    canonicalPathCache.set(p, result);
    return result;
}

const cache = new Map<string, CachedParse>();

type ParseCacheListener = (entry: CachedParse) => void;
const parseCacheListeners: ParseCacheListener[] = [];

export function onParseCacheEntryChanged(listener: ParseCacheListener): () => void {
    parseCacheListeners.push(listener);
    return () => {
        const index = parseCacheListeners.indexOf(listener);
        if (index >= 0) parseCacheListeners.splice(index, 1);
    };
}

function notifyParseCacheEntryChanged(entry: CachedParse): void {
    for (let i = 0; i < parseCacheListeners.length; i++) {
        try {
            parseCacheListeners[i](entry);
        } catch (_e) {}
    }
}

/**
 * Bumped whenever the SET of cached parses (or an entry's parsed value)
 * changes — a parse is added, re-parsed, or removed. Cache-wide scans over
 * `forEachCachedParse` (the tab strip's per-frame file→importable lookups)
 * memoize against this so they recompute only on an actual change instead of
 * every frame. Freshness/mtime touches don't bump it: they leave the parsed
 * importables untouched, so a scan's result can't change.
 */
let parseCacheRevision = 0;

export function getParseCacheRevision(): number {
    return parseCacheRevision;
}

export function parseCacheSizes(): { canonicalPaths: number; parses: number } {
    return { canonicalPaths: canonicalPathCache.size, parses: cache.size };
}

type ParsePerfEntry = {
    path: string;
    ms: number;
    source: "memory" | "snapshot" | "full" | "error";
    at: number;
};

const parsePerf: ParsePerfEntry[] = [];
type FullParseReason = {
    reason: string;
    paths: readonly string[];
};
const pendingFullParseReasons = new Map<string, FullParseReason>();

type FullParseProfile = {
    phases: ParsePhaseTimings & { mainThreadDerivedIndexMs: number };
    projectShape: OffThreadParseProfile["projectShape"];
    workerStartDelayMs: number | null;
    mainThreadCallbackDelayMs: number | null;
    unattributedMs: number | null;
};

function emptyParsePhases(): ParsePhaseTimings {
    return {
        sourceParseMs: 0,
        referencedPathFingerprintMs: 0,
        importableHashMs: 0,
        snapshotBuildMs: 0,
        snapshotSerializeMs: 0,
        snapshotWriteMs: 0,
    };
}

function recordParsePerf(
    path: string,
    ms: number,
    source: ParsePerfEntry["source"]
): void {
    parsePerf.push({ path, ms, source, at: Date.now() });
    if (parsePerf.length > 8) parsePerf.shift();
}

export function getParsePerfStats(): ParsePerfEntry[] {
    return parsePerf.slice();
}

function commitParseEntry(
    canon: string,
    rawPath: string,
    mtime: number,
    parsed: ImportablesParseResult | null,
    error: string | null,
    source: ParsePerfEntry["source"],
    fingerprint: { [path: string]: number } | null,
    fromSnapshot: boolean,
    snapshotAlreadySaved: boolean,
    startedAt: number,
    workerProfile: OffThreadParseProfile | null = null
): CachedParse {
    const fullParseProfile: FullParseProfile | null =
        workerProfile === null
            ? null
            : {
                  phases: {
                      ...workerProfile.phases,
                      mainThreadDerivedIndexMs: 0,
                  },
                  projectShape: workerProfile.projectShape,
                  workerStartDelayMs: workerProfile.workerStartDelayMs,
                  mainThreadCallbackDelayMs: workerProfile.mainThreadCallbackDelayMs,
                  unattributedMs: null,
              };
    let committedFingerprint: { [path: string]: number };
    if (fingerprint !== null) {
        committedFingerprint = fingerprint;
    } else if (parsed === null) {
        committedFingerprint = { [canon]: mtime };
    } else {
        const fingerprintStartedAt = Date.now();
        committedFingerprint = buildParseFingerprint(canon, mtime, parsed);
        if (fullParseProfile !== null) {
            fullParseProfile.phases.referencedPathFingerprintMs =
                Date.now() - fingerprintStartedAt;
        }
    }
    if (parsed !== null && !fromSnapshot && !snapshotAlreadySaved) {
        const snapshotMetrics = saveSnapshot(canon, parsed, committedFingerprint);
        if (fullParseProfile !== null) {
            fullParseProfile.phases.importableHashMs = snapshotMetrics.hashMs;
            fullParseProfile.phases.snapshotBuildMs = snapshotMetrics.buildMs;
            fullParseProfile.phases.snapshotSerializeMs = snapshotMetrics.serializeMs;
            fullParseProfile.phases.snapshotWriteMs = snapshotMetrics.writeMs;
            fullParseProfile.projectShape = {
                referencedPathCount: Object.keys(committedFingerprint).length,
                importableCount: parsed.value.length,
                diagnosticCount: parsed.diagnostics.length,
                snapshotBytes: snapshotMetrics.bytes,
            };
        }
    }
    const entry: CachedParse = {
        canonicalPath: canon,
        rawPath,
        mtime,
        parsed,
        fromSnapshot,
        error,
        fingerprint: committedFingerprint,
        freshness: createFreshness(),
    };
    cache.set(canon, entry);
    parseCacheRevision++;
    markGuiDirty();
    if (parsed !== null) {
        const derivedIndexStartedAt = Date.now();
        createItemDependencyIndex(
            parsed.value,
            createProjectItemIndex(parsed.value, parsed.gcx)
        );
        if (fullParseProfile !== null) {
            fullParseProfile.phases.mainThreadDerivedIndexMs =
                Date.now() - derivedIndexStartedAt;
        }
        recordHouseBinding(parsed.importJson.houseUuid, canon);
    }
    notifyParseCacheEntryChanged(entry);
    const durationMs = Date.now() - startedAt;
    if (fullParseProfile !== null) {
        const phases = fullParseProfile.phases;
        const profiledMs =
            phases.sourceParseMs +
            phases.referencedPathFingerprintMs +
            phases.importableHashMs +
            phases.snapshotBuildMs +
            phases.snapshotSerializeMs +
            phases.snapshotWriteMs +
            phases.mainThreadDerivedIndexMs +
            (fullParseProfile.workerStartDelayMs ?? 0) +
            (fullParseProfile.mainThreadCallbackDelayMs ?? 0);
        fullParseProfile.unattributedMs = Math.max(0, durationMs - profiledMs);
    }
    recordParsePerf(canon, durationMs, source);
    if (source === "full" || source === "error") {
        const pendingReason = pendingFullParseReasons.get(canon) ?? {
            reason: "no reusable parse",
            paths: [canon],
        };
        pendingFullParseReasons.delete(canon);
        if (durationMs >= 5000) {
            uploadSlowParseDiagnostics({
                canon,
                durationMs,
                source,
                reason: pendingReason.reason,
                changedPaths: pendingReason.paths,
                parsePerf: getParsePerfStats(),
                profile: fullParseProfile,
            });
        }
    }
    return entry;
}

function snapshotEntryIfFresh(
    canon: string,
    rawPath: string,
    mtime: number,
    startedAt: number
): CachedParse | null {
    const snapshot = loadSnapshot(canon);
    if (snapshot === null) return null;
    const changed = diffSnapshotFingerprint(snapshot);
    if (changed.length !== 0) return null;
    const parsed = restoreParseFromSnapshot(snapshot);
    return commitParseEntry(
        canon,
        rawPath,
        mtime,
        parsed,
        null,
        "snapshot",
        snapshot.fingerprint,
        true,
        true,
        startedAt
    );
}

function recordFullParseReason(
    canon: string,
    reason: string,
    paths: readonly string[]
): void {
    pendingFullParseReasons.set(canon, { reason, paths: paths.slice() });
}

function parseImportJsonFromDisk(
    canon: string,
    rawPath: string,
    mtime: number,
    startedAt: number
): CachedParse {
    let parsed: ImportablesParseResult | null = null;
    let error: string | null = null;
    let source: ParsePerfEntry["source"] = "full";
    const workerProfile: OffThreadParseProfile = {
        phases: emptyParsePhases(),
        projectShape: null,
        workerStartDelayMs: null,
        mainThreadCallbackDelayMs: null,
    };
    const sourceParseStartedAt = Date.now();
    const sm = new SourceMap(new FileSystemFileLoader());
    try {
        // Parse with the canonical absolute path, not the stored
        // `./htsw/...` form: the loader resolves every include to an
        // absolute path, and mixing forms in the file tree breaks any
        // path comparison against the root node (e.g. rehomeFileTree's
        // directory-containment check, which can never match a `./`
        // root against absolute children).
        parsed = parseImportablesResult(sm, canon);
    } catch (e) {
        const msg =
            e && (e as { message?: string }).message
                ? (e as { message: string }).message
                : String(e);
        error = msg;
        source = "error";
    }
    workerProfile.phases.sourceParseMs = Date.now() - sourceParseStartedAt;
    return commitParseEntry(
        canon,
        rawPath,
        mtime,
        parsed,
        error,
        source,
        null,
        false,
        false,
        startedAt,
        workerProfile
    );
}

/**
 * Parse `rawPath` if not cached or if the file changed on disk, and return
 * the cached parse (with `parsed: null + error: ...` on failure).
 *
 * BLOCKS the calling thread for the full parse cost on a cold path (no
 * in-memory entry) — for a big project that is the hundreds-of-ms-to-second
 * freeze. NEVER call this from render/element-build code or from a per-frame
 * getter; use `requestParse()` instead, which serves the warm cache and
 * schedules the cold parse off-frame. The only legitimate callers are the
 * deferred parse scheduler (`processPendingParses`), the reparse driver, and
 * user-initiated import/export tasks where a brief freeze is expected.
 */
export function parseImportJsonBlocking(rawPath: string): CachedParse {
    const startedAt = Date.now();
    const canon = canonicalPath(rawPath);
    const mtime = getMtimeMs(canon);
    const existing = cache.get(canon);
    // The import.json's own mtime is `mtime`; a referenced .htsl/.snbt edit
    // doesn't move it, so `settledChange` re-checks the whole fingerprint.
    if (
        existing !== undefined &&
        existing.mtime === mtime &&
        !settledChange(existing.fingerprint, existing.freshness)
    ) {
        recordParsePerf(canon, Date.now() - startedAt, "memory");
        return existing;
    }

    const snapshotEntry = snapshotEntryIfFresh(canon, rawPath, mtime, startedAt);
    if (snapshotEntry !== null) return snapshotEntry;
    return parseImportJsonFromDisk(canon, rawPath, mtime, startedAt);
}

/**
 * Like `parseImportJsonBlocking`, but stats the ENTIRE fingerprint
 * synchronously instead of going through the settle-debounced sweep. The
 * sweep needs several GUI ticks to confirm a referenced-file edit, so a
 * one-shot caller with the GUI closed (a slash command) would otherwise be
 * served the stale parse. Pays the full stat cost on the calling thread —
 * only for explicit user commands where current state matters more than a
 * brief freeze.
 */
export function parseImportJsonCurrentBlocking(rawPath: string): CachedParse {
    const canon = canonicalPath(rawPath);
    const existing = cache.get(canon);
    if (existing !== undefined) {
        const changedPaths: string[] = [];
        for (const path of Object.keys(existing.fingerprint)) {
            if (getMtimeMs(path) !== existing.fingerprint[path]) {
                changedPaths.push(path);
            }
        }
        if (changedPaths.length !== 0) {
            recordFullParseReason(canon, "source files changed", changedPaths);
            return parseImportJsonFromDisk(canon, rawPath, getMtimeMs(canon), Date.now());
        }
        resetFreshness(existing.freshness);
    }
    return parseImportJsonBlocking(rawPath);
}

function yieldFilesystemScan(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Verify every dependency without monopolizing the client thread. The first
 * scan of a large project can hit cold filesystem metadata; later scans are
 * usually served by the OS cache, but both follow the same time budget.
 */
export async function parseImportJsonCurrent(rawPath: string): Promise<CachedParse> {
    const startedAt = Date.now();
    const canon = canonicalPath(rawPath);
    const mtime = getMtimeMs(canon);
    const existing = cache.get(canon);
    if (existing === undefined) {
        const snapshotEntry = snapshotEntryIfFresh(canon, rawPath, mtime, startedAt);
        if (snapshotEntry !== null) return snapshotEntry;
        return await queueOffThreadParse(canon, rawPath, true);
    }

    const paths = Object.keys(existing.fingerprint);
    const changedPaths: string[] = [];
    let sliceStarted = Date.now();
    for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        const actual = path === canon ? mtime : getMtimeMs(path);
        if (
            actual !== existing.fingerprint[path] &&
            getMtimeMs(path) !== existing.fingerprint[path]
        ) {
            changedPaths.push(path);
        }
        if (Date.now() - sliceStarted >= 4 && i + 1 < paths.length) {
            await yieldFilesystemScan();
            sliceStarted = Date.now();
        }
    }
    if (changedPaths.length !== 0) {
        recordFullParseReason(canon, "source files changed", changedPaths);
        return await queueOffThreadParse(canon, rawPath, true);
    }
    existing.mtime = mtime;
    resetFreshness(existing.freshness);
    recordParsePerf(canon, Date.now() - startedAt, "memory");
    return existing;
}

/** Look up a previously-parsed import.json by canonical path. */
export function getParseAt(path: string): CachedParse | null {
    const canon = canonicalPath(path);
    return cache.get(canon) ?? null;
}

// ── Deferred parse scheduler ──────────────────────────────────────────────
// The render-safe way to obtain a parse. A cold full parse can freeze the
// client for a big project, so render/build code must never trigger one
// inline. `requestParse` serves the warm cache immediately and, when the parse
// is cold or due for a refresh, queues it to run off-frame via
// `processPendingParses` (pumped from the GUI tick). Callers render an
// empty/"pending" state until the cache warms a frame or two later.
type PendingParse = {
    rawPath: string;
    requireCurrent: boolean;
};

const pendingParsePaths = new Map<string, PendingParse>();
const pendingRevalidationPaths = new Map<string, string>();
type ParseInFlight = {
    path: string;
    revalidation: boolean;
};
let parseInFlight: ParseInFlight | null = null;
const parseWaiters = new Map<string, Array<(entry: CachedParse) => void>>();
let pendingOnParsed: ((entry: CachedParse) => void) | undefined;

function queueOffThreadParse(
    canon: string,
    rawPath: string,
    requireCurrent = false
): Promise<CachedParse> {
    const pending = pendingParsePaths.get(canon);
    pendingRevalidationPaths.delete(canon);
    pendingParsePaths.set(canon, {
        rawPath,
        requireCurrent: requireCurrent || pending?.requireCurrent === true,
    });
    const promise = new Promise<CachedParse>((resolve) => {
        const waiters = parseWaiters.get(canon);
        if (waiters === undefined) parseWaiters.set(canon, [resolve]);
        else waiters.push(resolve);
    });
    pumpPendingParses();
    return promise;
}

/**
 * Render-safe parse request. Returns the cached parse if one exists (and
 * queues a throttled off-frame revalidation so a referenced-file edit still
 * refreshes), or `null` if the file hasn't been parsed yet — in which case the
 * cold parse is queued to run off-frame. Never blocks on a parse.
 */
export function requestParse(rawPath: string): CachedParse | null {
    if (rawPath.trim() === "") return null;
    const canon = canonicalPath(rawPath);
    const existing = cache.get(canon);
    if (existing !== undefined) {
        if (isFreshnessCheckDue(existing.freshness)) {
            pendingRevalidationPaths.set(canon, rawPath);
        }
        return existing;
    }
    pendingParsePaths.set(canon, { rawPath, requireCurrent: false });
    return null;
}

export function isParsePending(rawPath: string): boolean {
    if (rawPath.trim() === "") return false;
    const canon = canonicalPath(rawPath);
    if (cache.has(canon)) return false;
    return (
        (parseInFlight?.path === canon && !parseInFlight.revalidation) ||
        pendingParsePaths.has(canon)
    );
}

/**
 * Pump at most one queued parse, off the render path. Yields a frame
 * (`setTimeout`) before the blocking parse so any "parsing" indicator can
 * paint first — mirroring the reparse driver. Call once per GUI tick.
 */
export function processPendingParses(onParsed?: (entry: CachedParse) => void): void {
    pendingOnParsed = onParsed;
    pumpPendingParses();
}

function finishPendingParse(
    canon: string,
    rawPath: string,
    previousEntry: CachedParse | undefined,
    parsedEntry: CachedParse
): void {
    if (parsedEntry.freshness.sweep !== null || parsedEntry.freshness.pending !== null) {
        pendingRevalidationPaths.set(canon, rawPath);
    } else {
        pendingRevalidationPaths.delete(canon);
    }
    if (parsedEntry !== previousEntry && pendingOnParsed !== undefined) {
        pendingOnParsed(parsedEntry);
    }
    const waiters = parseWaiters.get(canon);
    if (waiters !== undefined) {
        parseWaiters.delete(canon);
        for (let i = 0; i < waiters.length; i++) waiters[i](parsedEntry);
    }
    parseInFlight = null;
    pumpPendingParses();
}

function commitOffThreadResult(
    canon: string,
    rawPath: string,
    mtime: number,
    startedAt: number,
    result: OffThreadParseResult
): CachedParse {
    if (result.parsed !== null) {
        for (let i = 0; i < result.parsed.value.length; i++) {
            seedImportableHash(result.parsed.value[i], result.hashes[i]);
        }
    }
    return commitParseEntry(
        canon,
        rawPath,
        mtime,
        result.parsed,
        result.error,
        result.error === null ? "full" : "error",
        result.fingerprint,
        false,
        result.parsed !== null,
        startedAt,
        result.profile ?? null
    );
}

function pumpPendingParses(): void {
    if (parseInFlight !== null) return;
    let nextCanon: string | null = null;
    let nextRaw = "";
    let requireCurrent = false;
    for (const [canon, pending] of pendingParsePaths) {
        nextCanon = canon;
        nextRaw = pending.rawPath;
        requireCurrent = pending.requireCurrent;
        break;
    }
    let revalidation = false;
    if (nextCanon === null) {
        for (const [canon, rawPath] of pendingRevalidationPaths) {
            const entry = cache.get(canon);
            if (entry === undefined) {
                pendingRevalidationPaths.delete(canon);
                continue;
            }
            if (!isFreshnessCheckDue(entry.freshness)) continue;
            nextCanon = canon;
            nextRaw = rawPath;
            revalidation = true;
            break;
        }
    }
    if (nextCanon === null) return;
    const parseCanon = nextCanon;
    if (revalidation) pendingRevalidationPaths.delete(parseCanon);
    else pendingParsePaths.delete(parseCanon);
    parseInFlight = { path: parseCanon, revalidation };
    setTimeout(() => {
        const startedAt = Date.now();
        const mtime = getMtimeMs(parseCanon);
        const previousEntry = cache.get(parseCanon);
        let settledMtimes: { [path: string]: number } | null = null;
        if (
            !requireCurrent &&
            previousEntry !== undefined &&
            previousEntry.mtime === mtime
        ) {
            const pendingBeforeSettle = previousEntry.freshness.pending;
            if (!settledChange(previousEntry.fingerprint, previousEntry.freshness)) {
                recordParsePerf(parseCanon, Date.now() - startedAt, "memory");
                finishPendingParse(parseCanon, nextRaw, previousEntry, previousEntry);
                return;
            }
            settledMtimes = pendingBeforeSettle;
        }
        if (previousEntry === undefined) {
            const snapshot = loadSnapshot(parseCanon);
            if (snapshot !== null) {
                const snapshotChanges = diffSnapshotFingerprint(snapshot);
                if (snapshotChanges.length === 0) {
                    const parsed = restoreParseFromSnapshot(snapshot);
                    const snapshotEntry = commitParseEntry(
                        parseCanon,
                        nextRaw,
                        mtime,
                        parsed,
                        null,
                        "snapshot",
                        snapshot.fingerprint,
                        true,
                        true,
                        startedAt
                    );
                    finishPendingParse(parseCanon, nextRaw, previousEntry, snapshotEntry);
                    return;
                }
                recordFullParseReason(
                    parseCanon,
                    "saved parse is stale",
                    snapshotChanges.map((change) => change.path)
                );
            }
        } else {
            const observedMtimes: { [path: string]: number } = settledMtimes ?? {};
            const fingerprintPaths = Object.keys(previousEntry.fingerprint);
            if (settledMtimes === null) {
                for (let i = 0; i < fingerprintPaths.length; i++) {
                    const path = fingerprintPaths[i];
                    observedMtimes[path] = getMtimeMs(path);
                }
            }
            const changedPaths: string[] = [];
            for (let i = 0; i < fingerprintPaths.length; i++) {
                const path = fingerprintPaths[i];
                if (previousEntry.fingerprint[path] !== observedMtimes[path]) {
                    changedPaths.push(path);
                }
            }
            if (changedPaths.length !== 0) {
                recordFullParseReason(parseCanon, "source files changed", changedPaths);
            }
        }
        getMtimeMs(parseCanon);
        parseImportJsonOffThread(parseCanon, mtime, (result) => {
            if (getMtimeMs(parseCanon) !== mtime) {
                pendingParsePaths.set(parseCanon, {
                    rawPath: nextRaw,
                    requireCurrent,
                });
                parseInFlight = null;
                pumpPendingParses();
                return;
            }
            const entry = commitOffThreadResult(
                parseCanon,
                nextRaw,
                mtime,
                startedAt,
                result
            );
            finishPendingParse(parseCanon, nextRaw, previousEntry, entry);
        });
    }, 0);
}

/**
 * Re-save the disk snapshot from the (just-updated) in-memory parse. The
 * touch functions below mirror on-disk edits into the in-memory cache
 * WITHOUT re-parsing — but the snapshot on disk still holds the old
 * content and old fingerprint, so without this the next session pays a
 * full parse for an edit this session already absorbed.
 */
function resaveSnapshot(entry: CachedParse): void {
    if (entry.parsed === null) return;
    saveSnapshot(entry.canonicalPath, entry.parsed, entry.fingerprint);
}

function invalidateParseDerivedCaches(entry: CachedParse): void {
    if (entry.parsed === null) return;
    invalidateProjectItemIndex(entry.parsed.value);
    invalidateItemDependencyIndex(entry.parsed.value);
}

/**
 * Mark the cache entry's mtime as the file's current mtime, without
 * re-parsing. Use after an in-place mutation of the cached parse that
 * mirrors an on-disk edit, so the mtime check in `parseImportJsonBlocking`
 * doesn't force a full re-parse the next time it's called.
 */
export function touchParseCacheMtime(rawPath: string): void {
    const canon = canonicalPath(rawPath);
    const existing = cache.get(canon);
    if (existing === undefined) return;
    existing.mtime = getMtimeMs(canon);
    existing.fingerprint[canon] = existing.mtime;
    resetFreshness(existing.freshness);
    invalidateParseDerivedCaches(existing);
    resaveSnapshot(existing);
    parseCacheRevision++;
    markGuiDirty();
    notifyParseCacheEntryChanged(existing);
}

/**
 * Like `touchParseCacheMtime`, but for an edit that changed ONLY the
 * import.json itself (e.g. the houseUuid key): refreshes that one
 * fingerprint entry instead of re-stat-ing every referenced file, which on
 * a big project is a visible main-thread stall.
 */
export function touchParseCacheFile(rawPath: string): void {
    const canon = canonicalPath(rawPath);
    const existing = cache.get(canon);
    if (existing === undefined) return;
    existing.mtime = getMtimeMs(canon);
    existing.fingerprint[canon] = existing.mtime;
    resetFreshness(existing.freshness);
    resaveSnapshot(existing);
    parseCacheRevision++;
    markGuiDirty();
    notifyParseCacheEntryChanged(existing);
}

/**
 * Drop the cached parse for `rawPath` so the next `parseImportJsonBlocking`
 * re-parses from scratch. Used by the reparse driver for explicit
 * reloads (file load, rename, manual reparse) where we want a fresh
 * parse regardless of the fingerprint.
 */
export function invalidateParseCacheEntry(rawPath: string): void {
    if (!cache.delete(canonicalPath(rawPath))) return;
    parseCacheRevision++;
    markGuiDirty();
}

export function disposeParseCachesUnder(rawPath: string): void {
    const root = canonicalPath(rawPath);
    const prefix = root.endsWith("/") ? root : `${root}/`;
    const matches = (path: string): boolean => path === root || path.startsWith(prefix);
    let removed = 0;
    for (const entry of cache.values()) {
        if (!matches(entry.canonicalPath)) continue;
        invalidateParseDerivedCaches(entry);
        cache.delete(entry.canonicalPath);
        removed++;
    }
    canonicalPathCache.deleteWhere(
        (raw, canonical) => matches(raw) || matches(canonical)
    );
    if (removed === 0) return;
    parseCacheRevision++;
    markGuiDirty();
}

/**
 * Force the next parse WITHOUT dropping the current one. Readers keep the
 * last-good parse through the re-parse window; deleting instead leaves a
 * "no data" hole during which the tree collapses and bound-house chips
 * vanish for ~100ms + parse time after every scheduled reload. Use
 * `invalidateParseCacheEntry` only when the file itself is gone.
 */
export function markParseStale(rawPath: string): void {
    const entry = cache.get(canonicalPath(rawPath));
    if (entry === undefined) return;
    // Impossible mtime: the next parseImportJsonBlocking can't early-return
    // on an mtime match, so it re-parses (snapshot fast path still applies
    // when nothing on disk actually changed).
    entry.mtime = -1;
    entry.freshness.checkedAt = 0;
    entry.freshness.sweep = null;
}
/**
 * Iterate every parsed import.json. Used by the queue layer to find a
 * `QueueItem`'s importable when only its source path is known.
 */
export function forEachCachedParse(cb: (entry: CachedParse) => void): void {
    for (const v of cache.values()) cb(v);
}
