/// <reference types="../../../CTAutocomplete" />

import { ParseResult, parseImportablesResult, SourceMap } from "htsw";
import type { Importable } from "htsw/types";

import { FileSystemFileLoader } from "../../utils/files";
import { getMtimeMs, javaType } from "../lib/java";
import { invalidateKnowledgeOverlayForParse } from "./knowledgeOverlay";
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
 * the snapshot, and the Explore tree all agree on the set.
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
 * Per-file `import.json` parse cache. Lets the Explore tree show
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
    /**
     * mtimes of the import.json AND every file it referenced at parse time
     * (linked .htsl, .snbt, sub-list htsl). The import.json's own mtime is
     * not enough: editing a referenced .htsl doesn't touch the import.json,
     * so a mtime-only check would serve a stale parse. Validated (throttled)
     * on every `parseImportJsonAt`.
     */
    fingerprint: { [path: string]: number };
    /** `Date.now()` of the last fingerprint re-validation (throttle). */
    fpCheckedAt: number;
    /**
     * Mtimes observed when a change was first noticed but not yet acted on.
     * Re-parsing the instant a mtime moves reads a half-written file (editors
     * save in bursts / temp+rename) and flaps the dots. We instead wait until
     * the mtimes stop moving — re-parse only once a recheck sees the SAME new
     * mtimes as the previous recheck. Null when no change is in flight.
     */
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

// A real change: some file was successfully stat'd (mtime ≠ 0) with a
// different mtime than recorded. `0` means un-stat-able right now (the brief
// gap of an atomic temp+rename save) — not treated as a change.
function mtimesDiffer(
    fp: { [path: string]: number },
    cur: { [path: string]: number }
): boolean {
    for (const p in fp) {
        if (cur[p] !== 0 && cur[p] !== fp[p]) return true;
    }
    return false;
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
    if (existing !== undefined && existing.mtime === mtime) {
        // import.json unchanged, but a referenced .htsl/.snbt may have been
        // edited (its mtime isn't `canon`'s). Re-validate the full
        // fingerprint, throttled so we don't stat every referenced file each
        // frame. Stale at most until the next check (≤ FP_RECHECK_MS).
        const now = Date.now();
        if (now - existing.fpCheckedAt < FP_RECHECK_MS) return existing;
        existing.fpCheckedAt = now;
        const cur = currentMtimes(existing.fingerprint);
        if (!mtimesDiffer(existing.fingerprint, cur)) {
            existing.pending = null;
            return existing; // nothing changed
        }
        // A referenced file changed. Debounce until the mtimes settle so we
        // don't re-parse mid-save and flap: act only when this recheck sees
        // the same new mtimes as the previous one (i.e. the write finished).
        if (existing.pending === null || !sameMtimes(existing.pending, cur)) {
            existing.pending = cur; // first sighting, or still moving → wait
            return existing;
        }
        existing.pending = null; // stable across two rechecks → re-parse below
    }

    // Disk snapshot fast path: avoids a full htsw parse when the
    // import.json + every referenced .htsl still has the recorded
    // mtime. Critical for the Explore tree walker — without it,
    // discovering each large import.json freezes the main thread for
    // its full parse cost on first sighting per session, even though
    // `reparseImportJson` already used the snapshot.
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
    if (parsed !== null) invalidateKnowledgeOverlayForParse(parsed);
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
