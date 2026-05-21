import type { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import { ensureParentDirs } from "../utils/filesystem";
import { importableHash, listHashes } from "./hash";
import { cachePathFor, cachePathForId } from "./paths";

/**
 * Schema version for the importable cache format. Bump this when the
 * shape of `ImportableCacheEntry` changes in a way that prior readers would
 * mis-interpret. `readImportableCache` rejects entries with a different
 * version so stale caches don't poison a future trust-mode.
 */
const CACHE_SCHEMA_VERSION = 1;

export type CacheWriter = "exporter" | "importer";

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
        ctx.displayMessage(`&7[knowledge] saved &f${path}`);
    } catch (error) {
        ctx.displayMessage(`&7[knowledge] &eFailed to write cache at ${path}: ${error}`);
    }
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
    if (!FileLib.exists(path)) return null;

    let raw: string | null;
    try {
        raw = FileLib.read(path);
    } catch {
        return null;
    }
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

/** Remove an importable cache entry. No-op if it doesn't exist. */
export function deleteImportableCache(
    housingUuid: string,
    type: Importable["type"],
    identity: string
): void {
    const path = cachePathForId(housingUuid, type, identity);
    if (!FileLib.exists(path)) return;
    try {
        FileLib.delete(path);
    } catch {
        // best-effort
    }
}
