import type { Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import { ensureParentDirs } from "../utils/filesystem";
import { traceNote } from "../housingSync/trace/importTrace";
import { importableHash, listHashes } from "./hash";
import { getCurrentHousingUuid } from "./housingId";
import {
    IMPORT_CACHE_ROOT,
    cachePathFor,
    cachePathForId,
    cacheScanMarkerPath,
    cacheTypeDir,
    importableIdentity,
} from "./paths";

/**
 * Schema version for the importable cache format. Bump this when the shape
 * changes in a way prior readers would mis-interpret. v2 adds `name`/`verified`
 * and makes the content fields optional so an entry can record mere *presence*
 * ("this importable exists in the house") without content. v1 entries always
 * carry content, so they read as `verified`. Both versions are accepted.
 */
const CACHE_SCHEMA_VERSION = 2;
const ACCEPTED_SCHEMA_VERSIONS = [1, 2];

export type CacheWriter = "exporter" | "importer" | "reader";

// In-memory mirror of the on-disk cache, keyed by cache-file path. The
// knowledge-status build reads every importable's cache entry on every
// rebuild (one per dot); without this each rebuild did a `FileLib.read` +
// `JSON.parse` per importable — hundreds of blocking disk reads that made
// the dot fill stutter. These files are only ever written through this
// module, so the mirror stays authoritative: writes/deletes below keep it
// in sync.
const readCache = new Map<string, ImportableCacheEntry | null>();

// A content entry: the importable's full AST + hashes. This is what
// `readImportableCache` returns — presence-only records (no content) are not
// returned by it, so every diff/trust/import consumer is unchanged.
export type ImportableCacheEntry = {
    schemaVersion: number;
    /** ISO 8601 instant the entry was last written. Informational only. */
    writtenAt: string;
    /** The importable's identity/name, so the record is self-describing. */
    name?: string;
    /** True once content was confirmed by a read or sync (always true here). */
    verified?: boolean;
    /** Which subsystem populated the cache last. */
    writer: CacheWriter;
    /** The full importable, canonical-shaped (sorted keys, no undefined). */
    importable: Importable;
    /** `importableHash(importable)` at write time. */
    hash: string;
    /**
     * Per-action-list hashes keyed by dotted path (`"actions"`,
     * `"actions[3].ifActions"`, ...). Read by trust-mode (`importCache/trust`)
     * and the source diff to validate sub-trees cheaply.
     */
    lists: Record<string, string[]>;
};

// A presence record: "this importable exists in the house" with no content yet
// (written by a names scan or chat liveness). Stored at the same path as a
// content entry; `readImportableCache` returns null for it so content consumers
// treat it exactly like a missing file.
type PresenceRecord = {
    schemaVersion: number;
    writtenAt: string;
    name: string;
    verified: false;
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
        name: importableIdentity(importable),
        verified: true,
        writer,
        importable,
        hash: importableHash(importable),
        lists: listHashes(importable),
    };
}

/**
 * Persist an importable cache entry to disk. Best-effort: filesystem failures
 * are surfaced to chat as warnings but never abort the parent task —
 * the housingSync/exporter has already done its real work and the cache
 * is just a hint.
 */
export function writeImportableCache(
    ctx: TaskContext,
    housingUuid: string,
    importable: Importable,
    writer: CacheWriter,
    quiet?: boolean
): void {
    const path = cachePathFor(housingUuid, importable);
    const entry = buildImportableCacheEntry(importable, writer);
    try {
        ensureParentDirs(path);
        FileLib.write(path, JSON.stringify(entry, null, 4), true);
        readCache.set(path, entry);
        indexUpsert(housingUuid, importable.type, {
            name: importableIdentity(importable),
            type: importable.type,
            verified: true,
            importable,
        });
        if (quiet !== true) ctx.displayMessage(`&7[cache] saved &f${path}`);
    } catch (error) {
        ctx.displayMessage(`&7[cache] &eFailed to write cache at ${path}: ${error}`);
    }
}

/**
 * Best-effort cache write: resolve the housing UUID (falling back to /wtfmap
 * when one isn't supplied), persist the entry, and swallow any failure. The
 * real import/export work is already done by the time this runs — the cache is
 * a hint, not a contract, so a missing /wtfmap reply or filesystem error must
 * never abort the caller. Exporter failures warn unconditionally (export is a
 * deliberate, low-frequency action); importer failures only land in the import
 * trace, since a bulk import would otherwise spam the log.
 */
export async function tryWriteImportableCache(
    ctx: TaskContext,
    importable: Importable,
    writer: CacheWriter,
    cachedUuid?: string
): Promise<void> {
    try {
        const housingUuid = cachedUuid ?? (await getCurrentHousingUuid(ctx));
        writeImportableCache(ctx, housingUuid, importable, writer);
    } catch (error) {
        if (writer === "exporter") {
            ctx.displayMessage(`&7[export] &eCache write skipped: ${error}`);
        } else {
            traceNote("cache", `skipped cache write for ${importable.type}: ${error}`);
        }
    }
}

/**
 * Record that an importable *exists* in the house, without its content (from a
 * names scan or chat liveness). Never clobbers an existing content entry — a
 * cheap presence write must not wipe a verified read. Best-effort.
 */
export function writePresence(
    housingUuid: string,
    type: Importable["type"],
    name: string
): void {
    // Skip if this importable is already known — as content (don't clobber a
    // verified read) or as an existing presence record (don't re-write on every
    // rescan). `name` is the identity for every type (events included).
    const known = ensureEnumLoaded(housingUuid, type);
    for (let i = 0; i < known.length; i++) {
        if (known[i].name === name) return;
    }
    const path = cachePathForId(housingUuid, type, name);
    const record: PresenceRecord = {
        schemaVersion: CACHE_SCHEMA_VERSION,
        writtenAt: new Date().toISOString(),
        name,
        verified: false,
    };
    try {
        ensureParentDirs(path);
        FileLib.write(path, JSON.stringify(record, null, 4), true);
        // Content readers must see this as "no content".
        readCache.set(path, null);
        indexUpsert(housingUuid, type, { name, type, verified: false, importable: null });
    } catch (_e) {
        // best-effort
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
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as { schemaVersion?: unknown; importable?: unknown };
    if (
        typeof obj.schemaVersion !== "number" ||
        ACCEPTED_SCHEMA_VERSIONS.indexOf(obj.schemaVersion) === -1
    ) {
        return null;
    }
    // Presence-only records carry no importable; content readers see them as
    // "no cache" (null) so the importer/diff/trust never use a baseline-less
    // entry. v1 entries always have content, so they read as content.
    if (obj.importable === null || typeof obj.importable !== "object") {
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
    indexRemove(housingUuid, type, identity);
    try {
        const Paths = Java.type("java.nio.file.Paths");
        const Files = Java.type("java.nio.file.Files");
        Files.deleteIfExists(Paths.get(String(path)));
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
    enumIndex.clear();
    scanMarkerCache.clear();
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

// ── Enumeration (everything of a type in a house) ──────────────────────────
//
// `readImportableCache` answers "the baseline for importable X" — a targeted
// lookup the importer needs. The Houses tab needs the inverse: "every importable
// of this type in the house", including presence-only ones. The cache is one
// file per importable, so that means a directory scan — too expensive to do per
// render frame. So results live in an in-memory index: a lazy one-time disk scan
// per (uuid, type), then kept current by writes/deletes (above), so reads after
// the first are pure memory.

/** A house importable as the Houses tab sees it: a name, whether its content is
 *  known (verified), and the content itself when verified. */
export type HouseImportable = {
    name: string;
    type: Importable["type"];
    verified: boolean;
    importable: Importable | null;
};

const enumIndex = new Map<string, HouseImportable[]>();
const scanMarkerCache = new Map<string, boolean>();

function enumKey(uuid: string, type: Importable["type"]): string {
    return `${uuid}|${type}`;
}

function parseHouseRecord(raw: string | null, type: Importable["type"]): HouseImportable | null {
    if (raw === null) return null;
    let obj: { schemaVersion?: unknown; importable?: unknown; name?: unknown };
    try {
        obj = JSON.parse(String(raw));
    } catch {
        return null;
    }
    if (!obj || typeof obj !== "object") return null;
    if (
        typeof obj.schemaVersion !== "number" ||
        ACCEPTED_SCHEMA_VERSIONS.indexOf(obj.schemaVersion) === -1
    ) {
        return null;
    }
    if (obj.importable !== null && typeof obj.importable === "object") {
        const imp = obj.importable as Importable;
        const name = typeof obj.name === "string" ? obj.name : importableIdentity(imp);
        return { name, type, verified: true, importable: imp };
    }
    if (typeof obj.name === "string") {
        return { name: obj.name, type, verified: false, importable: null };
    }
    return null;
}

function scanTypeDir(uuid: string, type: Importable["type"]): HouseImportable[] {
    const out: HouseImportable[] = [];
    const dirRel = cacheTypeDir(uuid, type);
    try {
        const Paths = Java.type("java.nio.file.Paths");
        const Files = Java.type("java.nio.file.Files");
        const dir = Paths.get(String(dirRel));
        if (!Files.exists(dir) || !Files.isDirectory(dir)) return out;
        const stream = Files.newDirectoryStream(dir);
        try {
            const it = stream.iterator();
            while (it.hasNext()) {
                const fname = String(it.next().getFileName().toString());
                const suffix = ".knowledge.json";
                if (
                    fname.length < suffix.length ||
                    fname.lastIndexOf(suffix) !== fname.length - suffix.length
                ) {
                    continue;
                }
                let raw: string | null;
                try {
                    raw = FileLib.read(`${dirRel}/${fname}`);
                } catch {
                    raw = null;
                }
                const parsed = parseHouseRecord(raw, type);
                if (parsed !== null) out.push(parsed);
            }
        } finally {
            try { stream.close(); } catch (_e) { /* ignore */ }
        }
    } catch (_e) {
        // best-effort
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
}

function ensureEnumLoaded(uuid: string, type: Importable["type"]): HouseImportable[] {
    const key = enumKey(uuid, type);
    let list = enumIndex.get(key);
    if (list === undefined) {
        list = scanTypeDir(uuid, type);
        enumIndex.set(key, list);
    }
    return list;
}

// Keep the in-memory index current on writes/deletes. No-ops when the (uuid,
// type) hasn't been scanned yet — the lazy scan will pick the file up.
function indexUpsert(uuid: string, type: Importable["type"], entry: HouseImportable): void {
    const list = enumIndex.get(enumKey(uuid, type));
    if (list === undefined) return;
    for (let i = 0; i < list.length; i++) {
        if (list[i].name === entry.name) {
            list[i] = entry;
            return;
        }
    }
    list.push(entry);
    list.sort((a, b) => a.name.localeCompare(b.name));
}

function indexRemove(uuid: string, type: Importable["type"], identity: string): void {
    const list = enumIndex.get(enumKey(uuid, type));
    if (list === undefined) return;
    for (let i = 0; i < list.length; i++) {
        if (list[i].name === identity) {
            list.splice(i, 1);
            return;
        }
    }
}

/** Every importable of a type known for a house (presence + content). Cheap
 *  after the first call — a memory read kept in sync by writes. Returns a copy
 *  so callers can't mutate the index. */
export function listCachedImportables(
    uuid: string | null,
    type: Importable["type"]
): HouseImportable[] {
    if (uuid === null) return [];
    return ensureEnumLoaded(uuid, type).slice();
}

export function houseTypeScanned(
    uuid: string | null,
    type: Importable["type"]
): boolean {
    if (uuid === null) return false;
    const key = enumKey(uuid, type);
    const cached = scanMarkerCache.get(key);
    if (cached !== undefined) return cached;
    const scanned = FileLib.exists(cacheScanMarkerPath(uuid, type));
    scanMarkerCache.set(key, scanned);
    return scanned;
}

/**
 * Reconcile a house type's contents from a complete, successful names scan:
 * every current name gets a presence record (no-op if already known), and any
 * entry the house no longer has is removed — **including its content baseline**,
 * because a thing that isn't in the house has no baseline. Only call this with a
 * full successful scan (a partial/failed read would wrongly delete baselines).
 */
export function recordHouseScan(
    uuid: string,
    type: Importable["type"],
    names: readonly string[]
): void {
    const markerPath = cacheScanMarkerPath(uuid, type);
    try {
        ensureParentDirs(markerPath);
        FileLib.write(markerPath, new Date().toISOString(), true);
        scanMarkerCache.set(enumKey(uuid, type), true);
    } catch (_e) {
        scanMarkerCache.set(enumKey(uuid, type), false);
    }
    const present = new Set<string>();
    for (let i = 0; i < names.length; i++) present.add(names[i]);
    const known = ensureEnumLoaded(uuid, type).slice();
    for (let i = 0; i < known.length; i++) {
        if (!present.has(known[i].name)) {
            deleteImportableCache(uuid, type, known[i].name);
        }
    }
    for (let i = 0; i < names.length; i++) writePresence(uuid, type, names[i]);
}
