/// <reference types="../../../CTAutocomplete" />

import type { ParseResult } from "htsw";
import type { Importable } from "htsw/types";

import { rebuildCacheStatusRows } from "../cache-status/build";
import {
    getHousingUuid,
    getImportJsonPath,
    setImportJsonPath,
    setParseInProgress,
    setParsedResult,
} from "../state";
import { setCacheStatusRows } from "../cache-status/rows";
import { addRecent, getRecents } from "../persistence/recents";
import {
    invalidateParseCacheEntry,
    parseImportJsonAt,
    touchParseCacheMtime,
    type CachedParse,
} from "./parses";
import { snapshotExists } from "./parseSnapshot";
import { javaType } from "../lib/java";

/**
 * `reparse` is a thin DRIVER over the single parse authority,
 * `parseImportJsonAt` (parses.ts). It owns no parsing, snapshotting, or
 * mtime-watching of its own — that all lives in `parses.ts` /
 * `parseSnapshot.ts`, behind one fingerprint-based freshness check shared
 * with the Importables tree. This driver only:
 *   - tracks which import.json is active and debounces explicit reloads,
 *   - polls the authority each tick (cheap — it re-parses only when a
 *     referenced file's fingerprint changed, throttled internally),
 *   - propagates a changed parse into global state for the active import.json.
 */

// ── import.json auto-discovery ────────────────────────────────────────
const IMPORTS_ROOT = "./htsw/imports";

/**
 * Walk `./htsw/imports/**` for the first `import.json` we can find. Used
 * on init when the configured path doesn't exist yet — saves the user
 * having to type a path before anything appears.
 */
function findFirstImportJson(): string | null {
    try {
        const Files = javaType("java.nio.file.Files");
        const Paths = javaType("java.nio.file.Paths");
        const root = Paths.get(String(IMPORTS_ROOT));
        if (!Files.exists(root)) return null;
        return walkForImportJson(root);
    } catch (_e) {
        return null;
    }
}

function walkForImportJson(dir: any): string | null {
    const Files = javaType("java.nio.file.Files");
    let stream: any;
    try {
        stream = Files.newDirectoryStream(dir);
    } catch (_e) {
        return null;
    }
    try {
        const it = stream.iterator();
        const subdirs: any[] = [];
        while (it.hasNext()) {
            let p: any;
            try {
                p = it.next();
            } catch (_e) {
                break;
            }
            try {
                if (Files.isDirectory(p)) {
                    subdirs.push(p);
                } else if (Files.isRegularFile(p)) {
                    const name = String(p.getFileName().toString()).toLowerCase();
                    if (name === "import.json") {
                        return String(p.toString()).replace(/\\/g, "/");
                    }
                }
            } catch (_e) {
                // skip
            }
        }
        for (let i = 0; i < subdirs.length; i++) {
            const found = walkForImportJson(subdirs[i]);
            if (found !== null) return found;
        }
    } finally {
        try {
            stream.close();
        } catch (_e) {
            // ignore
        }
    }
    return null;
}

function fileExistsSafe(path: string): boolean {
    try {
        const Files = javaType("java.nio.file.Files");
        const Paths = javaType("java.nio.file.Paths");
        return Files.exists(Paths.get(String(path)));
    } catch (_e) {
        return false;
    }
}

/**
 * Run on overlay init. Restore the user's last-loaded import.json from
 * the recents file (persisted across module reloads); only fall back to
 * walking `./htsw/imports/` if nothing in recents still exists.
 */
export function autoDiscoverImportJson(): void {
    const recents = getRecents();
    for (let i = 0; i < recents.length; i++) {
        if (fileExistsSafe(recents[i])) {
            setImportJsonPath(recents[i]);
            return;
        }
    }
    if (fileExistsSafe(getImportJsonPath())) return;
    const found = findFirstImportJson();
    if (found !== null) {
        setImportJsonPath(found);
    }
}

// ── driver state ──────────────────────────────────────────────────────
let lastReparseAtMs = 0;
let pendingReparse = false;
let lastSeenPath = "";
let lastParsedRef: ParseResult<Importable[]> | null = null;
let forceInFlight = false;
const DEBOUNCE_MS = 300;

export function scheduleReparse(): void {
    pendingReparse = true;
    lastReparseAtMs = Date.now();
}

export function reparseNow(): void {
    pendingReparse = false;
    forceReparse(getImportJsonPath());
}

/**
 * Mark a file as already in sync with disk, so the next freshness check
 * doesn't trigger a redundant re-parse. Used after an in-place edit that
 * updated both the disk file AND the in-memory parse.
 */
export function markPathInSync(path: string): void {
    touchParseCacheMtime(path);
}

let cacheStatusGeneration = 0;
function scheduleCacheStatusRebuild(
    parsed: ParseResult<Importable[]> | null,
    progressive: boolean
): void {
    const gen = ++cacheStatusGeneration;
    setTimeout(() => {
        if (gen !== cacheStatusGeneration) return;
        const uuid = getHousingUuid();
        rebuildCacheStatusRows(
            uuid ?? "",
            uuid === null ? [] : (parsed?.value ?? []),
            progressive
        );
    }, 0);
}

function propagate(path: string, cached: CachedParse, progressive: boolean): void {
    lastSeenPath = path;
    lastParsedRef = cached.parsed;
    setParsedResult(cached.parsed);
    if (cached.parsed === null) {
        setCacheStatusRows([]);
        return;
    }
    addRecent(path);
    scheduleCacheStatusRebuild(cached.parsed, progressive);
}

/**
 * Explicit reload: drop the cached parse and re-run the authority. Raises
 * the "parse in progress" flag when a cold parse (no snapshot on disk) is
 * likely to block the main thread, and defers the parse one turn so the
 * flag can paint first.
 */
function forceReparse(path: string): void {
    lastSeenPath = path;
    if (path === "" || !fileExistsSafe(path)) {
        lastParsedRef = null;
        setParsedResult(null);
        setCacheStatusRows([]);
        return;
    }
    invalidateParseCacheEntry(path);
    forceInFlight = true;
    const willFreeze = !snapshotExists(path);
    if (willFreeze) setParseInProgress(true);
    setTimeout(() => {
        try {
            const cached = parseImportJsonAt(path);
            propagate(path, cached, /*progressive=*/ true);
        } catch (_e) {
            lastParsedRef = null;
            setParsedResult(null);
            setCacheStatusRows([]);
        }
        if (willFreeze) setParseInProgress(false);
        forceInFlight = false;
    }, 0);
}

/**
 * Tick hook. Loads a newly-selected import.json, honours the debounce for
 * scheduled reloads, then in steady state polls the parse authority and
 * propagates whenever it hands back a new parse (i.e. a referenced file
 * was edited). No mtime bookkeeping here — the authority owns freshness.
 */
export function tickReparse(): void {
    if (forceInFlight) return;

    const path = getImportJsonPath();
    if (path !== lastSeenPath) {
        forceReparse(path);
        return;
    }
    if (pendingReparse) {
        if (Date.now() - lastReparseAtMs >= DEBOUNCE_MS) {
            pendingReparse = false;
            forceReparse(path);
        }
        return;
    }
    if (path === "" || !fileExistsSafe(path)) return;
    const cached = parseImportJsonAt(path);
    if (cached.parsed !== lastParsedRef) propagate(path, cached, /*progressive=*/ false);
}
