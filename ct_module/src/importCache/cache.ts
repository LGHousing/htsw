import { COLORS, type Color, type FunctionIcon, type Importable } from "htsw/types";

import TaskContext from "../tasks/context";
import { atomicWriteText, getFileMtimeMs } from "../utils/filesystem";
import { traceNote } from "../housingSync/trace/taskTrace";
import { importableHash, listHashes } from "./hash";
import { getCurrentHousingUuid } from "./housingId";
import {
    IMPORT_CACHE_ROOT,
    cachePathFor,
    cachePathForId,
    cacheScanMarkerPath,
    cacheTypeDir,
} from "./paths";
import { importableIdentity } from "../importables/identity";
import { removedFormatting } from "../utils/helpers";
import type { ItemDependencySnapshot } from "../importables/items/dependencyIndex";
import { javaType } from "../utils/java";

/**
 * Schema version for the importable cache format. Bump this when the shape
 * changes in a way prior readers would mis-interpret. v2 adds `name`/`verified`
 * and makes the content fields optional so an entry can record mere *presence*
 * ("this importable exists in the house") without content. v1 entries always
 * carry content, so they read as `verified`. Both versions are accepted.
 */
const CACHE_SCHEMA_VERSION = 2;
const CACHE_ENTRY_VERSION = 1;
const ACCEPTED_SCHEMA_VERSIONS = [1, 2];

export type CacheWriter = "exporter" | "importer" | "reader" | "project-lock";

// In-memory mirror of the on-disk cache, keyed by cache-file path. The
// knowledge-status build reads every importable's cache entry on every
// rebuild (one per dot); without this each rebuild did a `FileLib.read` +
// `JSON.parse` per importable — hundreds of blocking disk reads that made
// the dot fill stutter. Writes/deletes below keep it coherent immediately;
// periodic mtime checks pick up changes made outside this process.
type ReadCacheMemo = {
    entry: ImportableCacheEntry | null;
    mtime: number;
    checkedAt: number;
};

const readCache = new Map<string, ReadCacheMemo>();

// Bumped on every content write/delete. Lets lazy consumers revalidate
// content-derived state without re-reading the filesystem. Presence-only
// writes don't bump: they read back as null content, so nothing derived from
// content can change.
let contentWriteRevision = 0;
let presenceWriteRevision = 0;

export function getImportCacheWriteRevision(): number {
    return contentWriteRevision;
}

export function getImportCachePresenceRevision(): number {
    return presenceWriteRevision;
}

// A content entry: the importable's full AST + hashes. This is what
// `readImportableCache` returns — presence-only records (no content) are not
// returned by it, so every diff/trust/import consumer is unchanged.
export type ImportableCacheEntry = {
    schemaVersion: number;
    version?: number;
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
    /** Referenced item contents verified along with this importable. */
    itemDependencies?: ItemDependencySnapshot;
};

export type ImportableCacheWriteOptions = {
    quiet?: boolean;
    itemDependencies?: ItemDependencySnapshot;
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
    // Display label when `name` (the identity) isn't a human name — NPCs store
    // their name here so the browser reads it without a deep read. Omitted when
    // the identity already is the display name.
    label?: string;
    icon?: FunctionIcon;
    color?: Color;
};

/**
 * Build a fresh cache entry for the given importable. Pure: no I/O.
 */
function buildImportableCacheEntry(
    importable: Importable,
    writer: CacheWriter,
    itemDependencies?: ItemDependencySnapshot
): ImportableCacheEntry {
    return {
        schemaVersion: CACHE_SCHEMA_VERSION,
        version: CACHE_ENTRY_VERSION,
        writtenAt: new Date().toISOString(),
        name: importableIdentity(importable),
        verified: true,
        writer,
        importable,
        hash: importableHash(importable),
        lists: listHashes(importable),
        ...(itemDependencies !== undefined ? { itemDependencies } : {}),
    };
}

// A house row's display label when its identity isn't itself a name: NPCs are
// keyed by position but should read as their name in the browser. Every other
// type's identity already is its name, so they need no separate label.
function houseDisplayLabel(importable: Importable): string | undefined {
    if (importable.type === "NPC") return removedFormatting(importable.name);
    return undefined;
}

function houseDisplayColor(importable: Importable): Color | undefined {
    if (importable.type === "TEAM" || importable.type === "GROUP")
        return importable.color;
    return undefined;
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
    quietOrOptions?: boolean | ImportableCacheWriteOptions,
    itemDependencies?: ItemDependencySnapshot
): boolean {
    const options: ImportableCacheWriteOptions =
        typeof quietOrOptions === "boolean"
            ? { quiet: quietOrOptions, itemDependencies }
            : (quietOrOptions ?? {});
    const path = cachePathFor(housingUuid, importable);
    const entry = buildImportableCacheEntry(importable, writer, options.itemDependencies);
    try {
        if (!atomicWriteText(path, JSON.stringify(entry, null, 4))) {
            throw new Error("write failed");
        }
        readCache.set(path, {
            entry,
            mtime: getFileMtimeMs(path),
            checkedAt: Date.now(),
        });
        contentWriteRevision++;
        indexUpsert(housingUuid, importable.type, {
            name: importableIdentity(importable),
            type: importable.type,
            verified: true,
            importable,
            label: houseDisplayLabel(importable),
            icon: importable.type === "FUNCTION" ? importable.icon : undefined,
            color: houseDisplayColor(importable),
        });
        if (options.quiet !== true) ctx.displayMessage(`&7[cache] saved &f${path}`);
        return true;
    } catch (error) {
        ctx.displayMessage(
            `&7[cache] &eFailed to write cache at ${path}: ${String(error)}`
        );
        return false;
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
    cachedUuid?: string,
    options?: ImportableCacheWriteOptions
): Promise<void> {
    try {
        const housingUuid = cachedUuid ?? (await getCurrentHousingUuid(ctx));
        writeImportableCache(ctx, housingUuid, importable, writer, options);
    } catch (error) {
        if (writer === "exporter") {
            ctx.displayMessage(`&7[export] &eCache write skipped: ${String(error)}`);
        } else {
            traceNote(
                "cache",
                `skipped cache write for ${importable.type}: ${String(error)}`
            );
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
    name: string,
    label?: string,
    icon?: FunctionIcon,
    color?: Color
): boolean {
    // Skip if this importable is already known — as content (don't clobber a
    // verified read) or as an existing presence record (don't re-write on every
    // rescan). `name` is the identity for every type (events included).
    const known = ensureEnumLoaded(housingUuid, type);
    let existing: HouseImportable | undefined;
    for (let i = 0; i < known.length; i++) {
        if (known[i].name === name) {
            existing = known[i];
            break;
        }
    }
    if (existing !== undefined && existing.verified) {
        if (icon !== undefined || color !== undefined) {
            indexUpsert(housingUuid, type, {
                ...existing,
                ...(icon !== undefined ? { icon } : {}),
                ...(color !== undefined ? { color } : {}),
            });
        }
        return true;
    }
    if (
        existing !== undefined &&
        existing.label === label &&
        existing.icon?.item === icon?.item &&
        (existing.icon?.count ?? 1) === (icon?.count ?? 1) &&
        existing.icon?.enchanted === icon?.enchanted &&
        existing.color === color
    ) {
        return true;
    }
    const path = cachePathForId(housingUuid, type, name);
    const record: PresenceRecord = {
        schemaVersion: CACHE_SCHEMA_VERSION,
        writtenAt: new Date().toISOString(),
        name,
        verified: false,
        ...((label ?? existing?.label) !== undefined
            ? { label: label ?? existing?.label }
            : {}),
        ...(icon !== undefined ? { icon } : {}),
        ...(color !== undefined ? { color } : {}),
    };
    try {
        if (!atomicWriteText(path, JSON.stringify(record, null, 4))) return false;
        readCache.set(path, {
            entry: null,
            mtime: getFileMtimeMs(path),
            checkedAt: Date.now(),
        });
        indexUpsert(housingUuid, type, {
            name,
            type,
            verified: false,
            importable: null,
            label: label ?? existing?.label,
            icon,
            color,
        });
        presenceWriteRevision++;
        return true;
    } catch (_e) {
        return false;
    }
}

function parseCacheEntry(raw: string | null): ImportableCacheEntry | null {
    if (raw === null) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
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
    const now = Date.now();
    const memo = readCache.get(path);
    if (memo !== undefined) {
        if (now - memo.checkedAt < 1000) return memo.entry;
        const mtime = getFileMtimeMs(path);
        if (mtime === memo.mtime) {
            memo.checkedAt = now;
            return memo.entry;
        }
    }
    // Stat BEFORE reading: if a writer swaps the file between the read and a
    // post-read stat, we'd store the new mtime with the old content and serve
    // stale until the next write. Stale-mtime-with-new-content (the other
    // ordering's failure) just re-reads on the next check.
    const mtimeBeforeRead = getFileMtimeMs(path);
    let raw: string | null;
    try {
        raw = FileLib.read(path);
    } catch {
        raw = null;
    }
    let entry = parseCacheEntry(raw);
    if (memo !== undefined && JSON.stringify(memo.entry) === JSON.stringify(entry)) {
        entry = memo.entry;
    }
    readCache.set(path, {
        entry,
        mtime: mtimeBeforeRead,
        checkedAt: now,
    });
    return entry;
}

/** Remove an importable cache entry. No-op if it doesn't exist. */
export function deleteImportableCache(
    housingUuid: string,
    type: Importable["type"],
    identity: string
): boolean {
    const path = cachePathForId(housingUuid, type, identity);
    try {
        const Paths = javaType("java.nio.file.Paths");
        const Files = javaType("java.nio.file.Files");
        Files.deleteIfExists(Paths.get(path));
    } catch {
        return false;
    }
    readCache.delete(path);
    contentWriteRevision++;
    presenceWriteRevision++;
    indexRemove(housingUuid, type, identity);
    return true;
}

export type HousingCacheDeleteResult = "deleted" | "missing" | "partial";

/** Delete every cache file for one house and report what remains. */
export function deleteHousingCache(housingUuid: string): HousingCacheDeleteResult {
    let result: HousingCacheDeleteResult;
    try {
        const Paths = javaType("java.nio.file.Paths");
        const Files = javaType("java.nio.file.Files");
        const root = Paths.get(`${IMPORT_CACHE_ROOT}/${housingUuid}`);
        if (!Files.exists(root)) {
            result = Files.notExists(root) ? "missing" : "partial";
        } else {
            let deleteCompleted = false;
            try {
                deletePathRecursive(Files, root);
                deleteCompleted = true;
            } catch (_deleteError) {}
            result = deleteCompleted && Files.notExists(root) ? "deleted" : "partial";
        }
    } catch (_e) {
        result = "partial";
    }

    // A partial delete can leave any subset of files behind. Force the next
    // lookup to rebuild its view from what is actually still on disk.
    readCache.clear();
    contentWriteRevision++;
    presenceWriteRevision++;
    enumIndex.clear();
    scanMarkerCache.clear();
    return result;
}

function deletePathRecursive(Files: HtswJavaFilesClass, path: HtswJavaPath): void {
    if (Files.isDirectory(path)) {
        const stream = Files.newDirectoryStream(path);
        try {
            const it = stream.iterator();
            while (it.hasNext()) {
                deletePathRecursive(Files, it.next());
            }
        } finally {
            try {
                stream.close();
            } catch (_e) {
                /* ignore */
            }
        }
    }
    Files.deleteIfExists(path);
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
    // Human-readable label when `name` (the identity) isn't itself a name, e.g.
    // an NPC keyed by position. Undefined = display `name` directly.
    label?: string;
    icon?: FunctionIcon;
    color?: Color;
};

const enumIndex = new Map<string, HouseImportable[]>();
const scanMarkerCache = new Map<string, boolean>();

function enumKey(uuid: string, type: Importable["type"]): string {
    return `${uuid}|${type}`;
}

function parseHouseRecord(
    raw: string | null,
    type: Importable["type"]
): HouseImportable | null {
    if (raw === null) return null;
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return null;
    }
    if (parsed === null || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    if (
        typeof obj.schemaVersion !== "number" ||
        ACCEPTED_SCHEMA_VERSIONS.indexOf(obj.schemaVersion) === -1
    ) {
        return null;
    }
    if (obj.importable !== null && typeof obj.importable === "object") {
        const imp = obj.importable as Importable;
        const name = typeof obj.name === "string" ? obj.name : importableIdentity(imp);
        return {
            name,
            type,
            verified: true,
            importable: imp,
            label: houseDisplayLabel(imp),
            icon: imp.type === "FUNCTION" ? imp.icon : undefined,
            color: houseDisplayColor(imp),
        };
    }
    if (typeof obj.name === "string") {
        return {
            name: obj.name,
            type,
            verified: false,
            importable: null,
            label: typeof obj.label === "string" ? obj.label : undefined,
            icon: parseStoredFunctionIcon(obj.icon),
            color: parseStoredColor(obj.color),
        };
    }
    return null;
}

function parseStoredFunctionIcon(value: unknown): FunctionIcon | undefined {
    if (value === null || typeof value !== "object") return undefined;
    const raw = value as { item?: unknown; count?: unknown; enchanted?: unknown };
    if (typeof raw.item !== "string") return undefined;
    return {
        item: raw.item,
        ...(typeof raw.count === "number" ? { count: raw.count } : {}),
        ...(raw.enchanted === true ? { enchanted: true } : {}),
    };
}

function parseStoredColor(value: unknown): Color | undefined {
    return typeof value === "string" && COLORS.indexOf(value as Color) !== -1
        ? (value as Color)
        : undefined;
}

function scanTypeDir(uuid: string, type: Importable["type"]): HouseImportable[] {
    const out: HouseImportable[] = [];
    const dirRel = cacheTypeDir(uuid, type);
    try {
        const Paths = javaType("java.nio.file.Paths");
        const Files = javaType("java.nio.file.Files");
        const dir = Paths.get(dirRel);
        if (!Files.exists(dir) || !Files.isDirectory(dir)) return out;
        const stream = Files.newDirectoryStream(dir);
        try {
            const it = stream.iterator();
            while (it.hasNext()) {
                const fileName = it.next().getFileName();
                if (fileName === null) continue;
                const fname = String(fileName.toString());
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
            try {
                stream.close();
            } catch (_e) {
                /* ignore */
            }
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
function indexUpsert(
    uuid: string,
    type: Importable["type"],
    entry: HouseImportable
): void {
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

export function houseTypeScanned(uuid: string | null, type: Importable["type"]): boolean {
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
    names: readonly string[],
    // Display labels keyed by identity, for types whose identity isn't a name
    // (NPCs, keyed by position). Omitted for name-identified types.
    labels?: ReadonlyMap<string, string>,
    icons?: ReadonlyMap<string, FunctionIcon>,
    colors?: ReadonlyMap<string, Color | undefined>
): void {
    const markerPath = cacheScanMarkerPath(uuid, type);
    const scanKey = enumKey(uuid, type);
    if (!removeScanMarker(markerPath)) {
        scanMarkerCache.set(scanKey, false);
        throw new Error(`Could not replace the saved ${type.toLowerCase()} scan`);
    }
    scanMarkerCache.set(scanKey, false);
    presenceWriteRevision++;

    const present = new Set<string>();
    for (let i = 0; i < names.length; i++) present.add(names[i]);
    enumIndex.delete(scanKey);
    const known = ensureEnumLoaded(uuid, type).slice();
    for (let i = 0; i < known.length; i++) {
        if (!present.has(known[i].name)) {
            if (!deleteImportableCache(uuid, type, known[i].name)) {
                throw new Error(
                    `Could not remove stale ${type.toLowerCase()} cache data`
                );
            }
        }
    }
    for (let i = 0; i < names.length; i++) {
        if (
            !writePresence(
                uuid,
                type,
                names[i],
                labels?.get(names[i]),
                icons?.get(names[i]),
                colors?.get(names[i])
            )
        ) {
            throw new Error(`Could not save ${type.toLowerCase()} scan data`);
        }
    }

    if (!atomicWriteText(markerPath, new Date().toISOString())) {
        throw new Error(`Could not mark the ${type.toLowerCase()} scan complete`);
    }
    scanMarkerCache.set(scanKey, true);
    presenceWriteRevision++;
}

function removeScanMarker(path: string): boolean {
    try {
        const Paths = javaType("java.nio.file.Paths");
        const Files = javaType("java.nio.file.Files");
        const marker = Paths.get(path);
        Files.deleteIfExists(marker);
        return !Files.exists(marker);
    } catch (_e) {
        return false;
    }
}
