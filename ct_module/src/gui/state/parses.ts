/// <reference types="../../../CTAutocomplete" />

import { ParseResult, parseImportablesResult, SourceMap } from "htsw";
import type { Importable } from "htsw/types";

import { FileSystemFileLoader } from "../../utils/fileLoaders";
import { getMtimeMs, javaType } from "../lib/java";
import { invalidateSourceDiffForParse } from "./sourceDiff";
import { allReferencedPaths } from "./importablePaths";
import {
    buildLiteParseResult,
    loadSnapshot,
    saveSnapshot,
    snapshotIsCurrent,
} from "./parseSnapshot";

/**
 * The mtime fingerprint for a parsed import.json: the import.json plus
 * every file it references. Built on `allReferencedPaths` — the single
 * source of "what files does this parse depend on" — so the parse cache,
 * the snapshot, and the Importables tree all agree on the set.
 */
function buildParseFingerprint(
    importJsonPath: string,
    importJsonMtime: number,
    parsed: ParseResult<Importable[]>
): { [path: string]: number } {
    const out: { [path: string]: number } = {};
    out[importJsonPath] = importJsonMtime;
    const paths = allReferencedPaths(importJsonPath, parsed);
    for (let i = 0; i < paths.length; i++) {
        const p = paths[i];
        if (out[p] === undefined) out[p] = getMtimeMs(p);
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
    parsed: ParseResult<Importable[]> | null;
    /** Non-null when the parse threw — e.g. malformed JSON. */
    error: string | null;
    /** mtime of the import.json and every file it referenced at parse time. */
    fingerprint: { [path: string]: number };
    /** `Date.now()` of the last `settledChange` re-check (throttle). */
    fpCheckedAt: number;
    /** Mtimes seen when a change was first noticed; drives `settledChange`'s debounce. Null when idle. */
    pending: { [path: string]: number } | null;
};

// How often `parseImportJsonAt` re-stats the referenced-file fingerprint on
// an import.json-mtime hit. Bounds the stat cost (≈ one stat per referenced
// file per interval); a change is acted on after it stays stable for one
// extra interval, so edit-to-refresh latency is ~1–2× this.
const FP_RECHECK_MS = 400;

function currentMtimes(fp: { [path: string]: number }): { [path: string]: number } {
    const out: { [path: string]: number } = {};
    for (const p in fp) out[p] = getMtimeMs(p);
    return out;
}

function sameMtimes(
    a: { [path: string]: number },
    b: { [path: string]: number }
): boolean {
    for (const p in a) {
        if (a[p] !== b[p]) return false;
    }
    return true;
}

// True when a referenced file changed AND its mtimes have settled — the same
// new values seen on two consecutive rechecks. Until then (a save still
// writing, or a temp+rename mid-swap) the mtimes keep moving, so this returns
// false and the caller serves the existing parse rather than reading a
// half-written file. Throttled; mutates the entry's recheck bookkeeping.
function settledChange(entry: CachedParse): boolean {
    const now = Date.now();
    if (now - entry.fpCheckedAt < FP_RECHECK_MS) return false;
    entry.fpCheckedAt = now;
    const cur = currentMtimes(entry.fingerprint);
    if (sameMtimes(entry.fingerprint, cur)) {
        entry.pending = null;
        return false;
    }
    if (entry.pending === null || !sameMtimes(entry.pending, cur)) {
        entry.pending = cur;
        return false;
    }
    entry.pending = null;
    return true;
}

function fingerprintOf(
    canon: string,
    mtime: number,
    parsed: ParseResult<Importable[]> | null
): { [path: string]: number } {
    if (parsed === null) {
        const fp: { [path: string]: number } = {};
        fp[canon] = mtime;
        return fp;
    }
    return buildParseFingerprint(canon, mtime, parsed);
}

export function canonicalPath(p: string): string {
    if (!p) return p;
    try {
        const Paths = javaType("java.nio.file.Paths");
        return String(Paths.get(String(p)).toAbsolutePath().normalize().toString())
            .replace(/\\/g, "/");
    } catch (_e) {
        return p.replace(/\\/g, "/");
    }
}

const cache = new Map<string, CachedParse>();

/**
 * Parse `rawPath` if not cached or if the file changed on disk. Returns
 * the cached parse either way (with `parsed: null + error: ...` on
 * failure). Safe to call from every render — the underlying work only
 * runs when the mtime has actually changed.
 */
export function parseImportJsonAt(rawPath: string): CachedParse {
    const canon = canonicalPath(rawPath);
    const mtime = getMtimeMs(canon);
    const existing = cache.get(canon);
    // The import.json's own mtime is `mtime`; a referenced .htsl/.snbt edit
    // doesn't move it, so `settledChange` re-checks the whole fingerprint.
    if (existing !== undefined && existing.mtime === mtime && !settledChange(existing)) {
        return existing;
    }

    // Disk snapshot fast path: avoids a full htsw parse when the
    // import.json + every referenced .htsl still has the recorded
    // mtime. Critical for the Importables tree walker — without it,
    // discovering each large import.json freezes the main thread for
    // its full parse cost on first sighting per session, even though
    // `reparseNow` already used the snapshot.
    let parsed: ParseResult<Importable[]> | null = null;
    let error: string | null = null;
    // For a lite (snapshot) parse the rebuilt result has empty spans, so
    // `fingerprintOf` would miss sub-list htsl paths. The snapshot already
    // carries a full fingerprint (built from a full parse at save time) —
    // use it so a sub-list edit is still detected.
    let snapshotFingerprint: { [path: string]: number } | null = null;
    const snapshot = loadSnapshot(canon);
    if (snapshot !== null && snapshotIsCurrent(snapshot)) {
        parsed = buildLiteParseResult(snapshot);
        snapshotFingerprint = snapshot.fingerprint;
    } else {
        const sm = new SourceMap(new FileSystemFileLoader());
        try {
            parsed = parseImportablesResult(sm, rawPath);
        } catch (e) {
            const msg = e && (e as { message?: string }).message
                ? (e as { message: string }).message
                : String(e);
            error = msg;
        }
        // Save a snapshot so the next session can skip this parse. The
        // fingerprint covers every referenced file (via allReferencedPaths)
        // so edits to sub-list .htsl files (REGION enter/exit, ITEM click
        // actions) invalidate it too. Errored parses are not snapshotted —
        // they must re-parse fully so the import gate sees real,
        // span-bearing diagnostics.
        if (parsed !== null && !parsed.gcx.isFailed()) {
            const fingerprint = buildParseFingerprint(canon, mtime, parsed);
            saveSnapshot(canon, parsed, fingerprint);
        }
    }
    const entry: CachedParse = {
        canonicalPath: canon,
        rawPath,
        mtime,
        parsed,
        error,
        fingerprint: snapshotFingerprint ?? fingerprintOf(canon, mtime, parsed),
        fpCheckedAt: Date.now(),
        pending: null,
    };
    cache.set(canon, entry);
    if (parsed !== null) invalidateSourceDiffForParse(parsed);
    return entry;
}

/** Look up a previously-parsed import.json by canonical path. */
export function getParseAt(path: string): CachedParse | null {
    const canon = canonicalPath(path);
    return cache.get(canon) ?? null;
}

/**
 * Mark the cache entry's mtime as the file's current mtime, without
 * re-parsing. Use after an in-place mutation of the cached parse that
 * mirrors an on-disk edit, so the mtime check in `parseImportJsonAt`
 * doesn't force a full re-parse the next time it's called.
 */
export function touchParseCacheMtime(rawPath: string): void {
    const canon = canonicalPath(rawPath);
    const existing = cache.get(canon);
    if (existing === undefined) return;
    existing.mtime = getMtimeMs(canon);
    existing.fingerprint = fingerprintOf(canon, existing.mtime, existing.parsed);
    existing.fpCheckedAt = Date.now();
    existing.pending = null;
}

/**
 * Drop the cached parse for `rawPath` so the next `parseImportJsonAt`
 * re-parses from scratch. Used by the reparse driver for explicit
 * reloads (file load, rename, manual reparse) where we want a fresh
 * parse regardless of the fingerprint.
 */
export function invalidateParseCacheEntry(rawPath: string): void {
    cache.delete(canonicalPath(rawPath));
}
/**
 * Iterate every parsed import.json. Used by the queue layer to find a
 * `QueueItem`'s importable when only its source path is known.
 */
export function forEachCachedParse(cb: (entry: CachedParse) => void): void {
    for (const v of cache.values()) cb(v);
}
