/// <reference types="../../../CTAutocomplete" />

import { ParseResult, parseImportablesResult, SourceMap } from "htsw";
import type { Importable } from "htsw/types";

import { FileSystemFileLoader } from "../../utils/files";

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
};

export function canonicalPath(p: string): string {
    if (!p) return p;
    try {
        // @ts-ignore
        const Paths = Java.type("java.nio.file.Paths");
        return String(Paths.get(String(p)).toAbsolutePath().normalize().toString())
            .replace(/\\/g, "/");
    } catch (_e) {
        return p.replace(/\\/g, "/");
    }
}

function getMtimeMs(path: string): number {
    try {
        // @ts-ignore
        const Paths = Java.type("java.nio.file.Paths");
        // @ts-ignore
        const Files = Java.type("java.nio.file.Files");
        return Number(Files.getLastModifiedTime(Paths.get(String(path))).toMillis());
    } catch (_e) {
        return 0;
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
    if (existing !== undefined && existing.mtime === mtime) return existing;

    const sm = new SourceMap(new FileSystemFileLoader());
    let parsed: ParseResult<Importable[]> | null = null;
    let error: string | null = null;
    try {
        parsed = parseImportablesResult(sm, rawPath);
    } catch (e) {
        const msg = e && (e as { message?: string }).message
            ? (e as { message: string }).message
            : String(e);
        error = msg;
    }
    const entry: CachedParse = {
        canonicalPath: canon,
        rawPath,
        mtime,
        parsed,
        error,
    };
    cache.set(canon, entry);
    return entry;
}

/** Look up a previously-parsed import.json by canonical path. */
export function getParseAt(path: string): CachedParse | null {
    const canon = canonicalPath(path);
    return cache.get(canon) ?? null;
}

/**
 * Drop the cached parse for `path`. Used when the source file is removed
 * from the Explore tree so we don't grow the cache forever.
 */
export function evictParseAt(path: string): void {
    const canon = canonicalPath(path);
    cache.delete(canon);
}

/**
 * Iterate every parsed import.json. Used by the queue layer to find a
 * `QueueItem`'s importable when only its source path is known.
 */
export function forEachCachedParse(cb: (entry: CachedParse) => void): void {
    for (const v of cache.values()) cb(v);
}
