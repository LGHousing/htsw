/// <reference types="../../../CTAutocomplete" />

import {
    ImportablesParseResult,
    parseImportablesResult,
    SourceMap,
} from "htsw";

import { FileSystemFileLoader } from "../../utils/fileLoaders";
import { recordHouseBinding } from "../../importCache/houseBindings";
import { getMtimeMs, javaType } from "../lib/java";
import { allReferencedPaths } from "./importablePaths";
import {
    diffSnapshotFingerprint,
    loadSnapshot,
    restoreParseFromSnapshot,
    saveSnapshot,
} from "./parseSnapshot";
import {
    FP_RECHECK_MS,
    createFreshness,
    resetFreshness,
    settledChange,
    type FingerprintFreshness,
} from "./freshness";

/**
 * The mtime fingerprint for a parsed import.json: the import.json plus
 * every file it references. Built on `allReferencedPaths` — the single
 * source of "what files does this parse depend on" — so the parse cache,
 * the snapshot, and the Importables tree all agree on the set.
 */
function buildParseFingerprint(
    importJsonPath: string,
    importJsonMtime: number,
    parsed: ImportablesParseResult
): { [path: string]: number } {
    const out: { [path: string]: number } = {};
    out[importJsonPath] = importJsonMtime;
    const paths = allReferencedPaths(importJsonPath, parsed);
    for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        if (out[p] === undefined) out[p] = getMtimeMs(p);
    }
    const missingImportJsonPaths = parsed.importJson.missingImportJsonPaths;
    for (let i = 0; i < missingImportJsonPaths.length; i++) {
        const p = missingImportJsonPaths[i];
        if (out[p] === undefined) out[p] = 0;
    }
    return out;
}

/**
 * Per-file `import.json` parse cache. Lets the Importables tree show
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

function fingerprintOf(
    canon: string,
    mtime: number,
    parsed: ImportablesParseResult | null
): { [path: string]: number } {
    if (parsed === null) {
        const fp: { [path: string]: number } = {};
        fp[canon] = mtime;
        return fp;
    }
    return buildParseFingerprint(canon, mtime, parsed);
}

// `canonicalPath` is called all over the render paths (per file tab, per
// queue item, per importable in the cache scans) — and each call did a fresh
// `Java.type("java.nio.file.Paths")` lookup plus NIO path ops, which `java.ts`
// already warns is "not free". The result is a pure function of the input
// string (the process CWD is stable for the session), so memoize by input.
let _Paths: any = null;
const canonicalPathCache = new Map<string, string>();

export function canonicalPath(p: string): string {
    if (!p) return p;
    const hit = canonicalPathCache.get(p);
    if (hit !== undefined) return hit;
    let result: string;
    try {
        if (_Paths === null) _Paths = javaType("java.nio.file.Paths");
        result = String(_Paths.get(String(p)).toAbsolutePath().normalize().toString())
            .replace(/\\/g, "/");
    } catch (_e) {
        result = p.replace(/\\/g, "/");
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
 * changes — a parse is added, re-parsed, or evicted. Cache-wide scans over
 * `forEachCachedParse` (the tab strip's per-frame file→importable lookups)
 * memoize against this so they recompute only on an actual change instead of
 * every frame. Freshness/mtime touches don't bump it: they leave the parsed
 * importables untouched, so a scan's result can't change.
 */
let parseCacheRevision = 0;

export function getParseCacheRevision(): number {
    return parseCacheRevision;
}

type ParsePerfEntry = {
    path: string;
    ms: number;
    source: "memory" | "snapshot" | "full" | "error";
    at: number;
};

const parsePerf: ParsePerfEntry[] = [];

function recordParsePerf(path: string, ms: number, source: ParsePerfEntry["source"]): void {
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
    snapshotFingerprint: { [path: string]: number } | null,
    startedAt: number
): CachedParse {
    let fingerprint = snapshotFingerprint ?? fingerprintOf(canon, mtime, parsed);
    if (parsed !== null && snapshotFingerprint === null) {
        fingerprint = buildParseFingerprint(canon, mtime, parsed);
        saveSnapshot(canon, parsed, fingerprint);
    }
    const entry: CachedParse = {
        canonicalPath: canon,
        rawPath,
        mtime,
        parsed,
        fromSnapshot: snapshotFingerprint !== null,
        error,
        fingerprint,
        freshness: createFreshness(),
    };
    cache.set(canon, entry);
    parseCacheRevision++;
    if (parsed !== null) {
        recordHouseBinding(parsed.importJson.houseUuid, canon);
    }
    notifyParseCacheEntryChanged(entry);
    recordParsePerf(canon, Date.now() - startedAt, source);
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
    return commitParseEntry(canon, rawPath, mtime, parsed, null, "snapshot", snapshot.fingerprint, startedAt);
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

    let parsed: ImportablesParseResult | null = null;
    let error: string | null = null;
    let source: ParsePerfEntry["source"] = "full";
    const snapshotEntry = snapshotEntryIfFresh(canon, rawPath, mtime, startedAt);
    if (snapshotEntry !== null) return snapshotEntry;
    if (parsed === null) {
        const sm = new SourceMap(new FileSystemFileLoader());
        try {
            parsed = parseImportablesResult(sm, rawPath);
        } catch (e) {
            const msg = e && (e as { message?: string }).message
                ? (e as { message: string }).message
                : String(e);
            error = msg;
            source = "error";
        }
    }
    return commitParseEntry(canon, rawPath, mtime, parsed, error, source, null, startedAt);
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
const pendingParsePaths = new Map<string, string>();
let parseInFlightPath: string | null = null;

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
        if (Date.now() - existing.freshness.checkedAt >= FP_RECHECK_MS) {
            pendingParsePaths.set(canon, rawPath);
        }
        return existing;
    }
    pendingParsePaths.set(canon, rawPath);
    return null;
}

export function isParsePending(rawPath: string): boolean {
    if (rawPath.trim() === "") return false;
    const canon = canonicalPath(rawPath);
    return parseInFlightPath === canon || pendingParsePaths.has(canon);
}

/**
 * Pump at most one queued parse, off the render path. Yields a frame
 * (`setTimeout`) before the blocking parse so any "parsing" indicator can
 * paint first — mirroring the reparse driver. Call once per GUI tick.
 */
export function processPendingParses(onParsed?: (entry: CachedParse) => void): void {
    if (parseInFlightPath !== null) return;
    let nextCanon: string | null = null;
    let nextRaw = "";
    for (const [canon, rawPath] of pendingParsePaths) {
        nextCanon = canon;
        nextRaw = rawPath;
        break;
    }
    if (nextCanon === null) return;
    const parseCanon = nextCanon;
    pendingParsePaths.delete(parseCanon);
    parseInFlightPath = parseCanon;
    setTimeout(() => {
        try {
            let parsedEntry: CachedParse | null = null;
            const previousEntry = cache.get(parseCanon);
            try {
                parsedEntry = parseImportJsonBlocking(nextRaw);
            } catch (_e) {
                // A failed parse is cached as an error entry by the authority.
            }
            if (
                parsedEntry !== null &&
                parsedEntry !== previousEntry &&
                onParsed !== undefined
            ) {
                onParsed(parsedEntry);
            }
        } finally {
            parseInFlightPath = null;
        }
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
    existing.fingerprint = fingerprintOf(canon, existing.mtime, existing.parsed);
    resetFreshness(existing.freshness);
    resaveSnapshot(existing);
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
    notifyParseCacheEntryChanged(existing);
}

/**
 * Drop the cached parse for `rawPath` so the next `parseImportJsonBlocking`
 * re-parses from scratch. Used by the reparse driver for explicit
 * reloads (file load, rename, manual reparse) where we want a fresh
 * parse regardless of the fingerprint.
 */
export function invalidateParseCacheEntry(rawPath: string): void {
    if (cache.delete(canonicalPath(rawPath))) parseCacheRevision++;
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
