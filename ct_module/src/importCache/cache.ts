import type { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import { ensureParentDirs } from "../utils/filesystem";
import { importableHash, listHashes } from "./hash";
import { IMPORT_CACHE_ROOT, cachePathFor, cachePathForId } from "./paths";

/**
 * Schema version for the importable cache format. Bump this when the
 * shape of `ImportableCacheEntry` changes in a way that prior readers would
 * mis-interpret. `readImportableCache` rejects entries with a different
 * version so stale caches don't poison a future trust-mode.
 */
const CACHE_SCHEMA_VERSION = 1;

export type CacheWriter = "exporter" | "importer";

// In-memory mirror of the on-disk cache, keyed by cache-file path. The
// knowledge-status build reads every importable's cache entry on every
// rebuild (one per dot); without this each rebuild did a `FileLib.read` +
// `JSON.parse` per importable — hundreds of blocking disk reads that made
// the dot fill stutter. These files are only ever written through this
// module, so the mirror stays authoritative: writes/deletes below keep it
// in sync.
const readCache = new Map<string, ImportableCacheEntry | null>();

export type ImportableCacheEntry = {
    schemaVersion: typeof CACHE_SCHEMA_VERSION;
    /** ISO 8601 instant the entry was last written. Informational only. */
    writtenAt: string;
    /** Which subsystem populated the cache last. */
    writer: CacheWriter;
    /** The full importable, canonical-shaped (sorted keys, no undefined). */
    importable: Importable;
    /** `importableHash(importable)` at write time. */
    hash: string;
    /**
     * Per-action-list hashes keyed by dotted path (`"actions"`,
     * `"actions[3].ifActions"`, ...). Used by future trust-mode to
     * validate sub-trees cheaply.
     */
    lists: Record<string, string[]>;
};

/**
 * Build a fresh cache entry for the given importable. Pure: no I/O.
 */
function buildImportableCacheEntry(
    importable: Importable,
    writer: CacheWriter
): ImportableCacheEntry {
    return {
        schemaVersion: CACHE_SCHEMA_VERSION,
        writtenAt: new Date().toISOString(),
        writer,
        importable,
        hash: importableHash(importable),
        lists: listHashes(importable),
    };
}

/**
 * Persist an importable cache entry to disk. Best-effort: filesystem failures
 * are surfaced to chat as warnings but never abort the parent task —
 * the importer/exporter has already done its real work and the cache
 * is just a hint.
 */
export function writeImportableCache(
    ctx: TaskContext,
    housingUuid: string,
    importable: Importable,
    writer: CacheWriter
): void {
    const path = cachePathFor(housingUuid, importable);
    const entry = buildImportableCacheEntry(importable, writer);
    try {
        ensureParentDirs(path);
        FileLib.write(path, JSON.stringify(entry, null, 4), true);
        readCache.set(path, entry);
        ctx.displayMessage(`&7[cache] saved &f${path}`);
    } catch (error) {
        ctx.displayMessage(`&7[cache] &eFailed to write cache at ${path}: ${error}`);
    }
}

function parseCacheEntry(raw: string | null): ImportableCacheEntry | null {
    if (raw === null) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(String(raw));
    } catch {
        return null;
    }
    if (
        !parsed ||
        typeof parsed !== "object" ||
        (parsed as { schemaVersion?: unknown }).schemaVersion !== CACHE_SCHEMA_VERSION
    ) {
        return null;
    }
    return parsed as ImportableCacheEntry;
}

/**
 * Load an importable cache entry, or null if the file is missing, unreadable,
 * malformed, or schema-mismatched. Never throws — callers treat null
 * as "no trusted state".
 */
export function readImportableCache(
    housingUuid: string,
    type: Importable["type"],
    identity: string
): ImportableCacheEntry | null {
    const path = cachePathForId(housingUuid, type, identity);
    if (readCache.has(path)) return readCache.get(path) ?? null;
    let raw: string | null;
    try {
        raw = FileLib.read(path);
    } catch {
        raw = null;
    }
    const entry = parseCacheEntry(raw);
    readCache.set(path, entry);
    return entry;
}

/** Remove an importable cache entry. No-op if it doesn't exist. */
export function deleteImportableCache(
    housingUuid: string,
    type: Importable["type"],
    identity: string
): void {
    const path = cachePathForId(housingUuid, type, identity);
    readCache.delete(path);
    if (!FileLib.exists(path)) return;
    try {
        FileLib.delete(path);
    } catch {
        // best-effort
    }
}

/**
 * Recursively delete the entire per-housing cache directory:
 * `./htsw/.cache/<uuid>/` and everything beneath it (all importable
 * `.knowledge.json` files plus the `items/` SNBT cache). Best-effort —
 * any individual delete failure is swallowed.
 */
export function deleteHousingCache(housingUuid: string): boolean {
    readCache.clear();
    try {
        const Paths = Java.type("java.nio.file.Paths");
        const Files = Java.type("java.nio.file.Files");
        const root = Paths.get(String(`${IMPORT_CACHE_ROOT}/${housingUuid}`));
        if (!Files.exists(root)) return false;
        deletePathRecursive(Files, root);
        return true;
    } catch (_e) {
        return false;
    }
}

function deletePathRecursive(Files: any, path: any): void {
    try {
        if (Files.isDirectory(path)) {
            const stream = Files.newDirectoryStream(path);
            try {
                const it = stream.iterator();
                while (it.hasNext()) {
                    deletePathRecursive(Files, it.next());
                }
            } finally {
                try { stream.close(); } catch (_e) { /* ignore */ }
            }
        }
        Files.delete(path);
    } catch (_e) {
        // best-effort
    }
}
