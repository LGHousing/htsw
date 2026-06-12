/// <reference types="../../../CTAutocomplete" />

import type { ParseResult } from "htsw";
import type { Importable } from "htsw/types";

import {
    getImportJsonPath,
    setImportJsonPath,
    setParseInProgress,
    setParsedResult,
} from "../state";
import { addRecent, getRecents } from "../persistence/recents";
import {
    getParseAt,
    invalidateParseCacheEntry,
    parseImportJsonBlocking,
    touchParseCacheMtime,
    type CachedParse,
} from "./parses";
import { javaType } from "../lib/java";
import { PROJECTS_ROOT } from "../../exporter/paths";

/**
 * `reparse` is a thin DRIVER over the single parse authority,
 * `parseImportJsonBlocking` (parses.ts). It owns no parsing, snapshotting, or
 * mtime-watching of its own — that all lives in `parses.ts` /
 * `parseSnapshot.ts`, behind one fingerprint-based freshness check shared
 * with the Importables tree. This driver only:
 *   - tracks which import.json is active and debounces explicit reloads,
 *   - polls the authority each tick (cheap — it re-parses only when a
 *     referenced file's fingerprint changed, throttled internally),
 *   - propagates a changed parse into global state for the active import.json.
 */

// ── import.json auto-discovery ────────────────────────────────────────

/**
 * Walk `PROJECTS_ROOT/**` for the first `import.json` we can find. Used
 * on init when the configured path doesn't exist yet — saves the user
 * having to type a path before anything appears.
 */
function findFirstImportJson(): string | null {
    try {
        const Files = javaType("java.nio.file.Files");
        const Paths = javaType("java.nio.file.Paths");
        const root = Paths.get(String(PROJECTS_ROOT));
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
 * walking the projects root if nothing in recents still exists.
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
    forceReparse(getImportJsonPath(), /*forceFresh=*/ true);
}

/**
 * Mark a file as already in sync with disk, so the next freshness check
 * doesn't trigger a redundant re-parse. Used after an in-place edit that
 * updated both the disk file AND the in-memory parse.
 */
export function markPathInSync(path: string): void {
    touchParseCacheMtime(path);
}

function propagate(path: string, cached: CachedParse): void {
    lastSeenPath = path;
    lastParsedRef = cached.parsed;
    setParsedResult(cached.parsed);
    if (cached.parsed === null) return;
    addRecent(path);
}

/**
 * Explicit reload: re-run the authority for `path`. With `forceFresh`, first
 * drops the cached parse so the authority re-reads disk now instead of waiting
 * out its settle throttle (used after an export or an explicit reload). Raises
 * the "parse in progress" flag only when there's no content to show yet AND a
 * cold parse (no snapshot on disk) is likely to block the main thread —
 * switching to an already-parsed file keeps its rows on screen instead of
 * flashing the loading row for one frame.
 */
function forceReparse(path: string, forceFresh: boolean): void {
    lastSeenPath = path;
    if (path === "" || !fileExistsSafe(path)) {
        lastParsedRef = null;
        setParsedResult(null);
        return;
    }
    const existing = getParseAt(path);
    const haveContent = existing !== null && existing.parsed !== null;
    if (forceFresh) invalidateParseCacheEntry(path);
    forceInFlight = true;
    // Any cold load stalls the client — a snapshot load is lighter than a
    // full parse but still blocks Rhino for a beat on big projects, so it
    // gets the loading flag + paint delay too. (Gating on snapshotExists
    // here meant snapshot loads froze with no loading frame at all.)
    const willFreeze = !haveContent;
    if (willFreeze) setParseInProgress(true);
    // When the parse will freeze the client, give the renderer a beat to
    // paint first — otherwise setTimeout(0) races the next frame and usually
    // wins, freezing the screen on the PREVIOUS frame (popovers the click
    // just closed still open, no "Parsing project…" row).
    setTimeout(() => {
        try {
            const cached = parseImportJsonBlocking(path);
            propagate(path, cached);
        } catch (_e) {
            lastParsedRef = null;
            setParsedResult(null);
        }
        if (willFreeze) setParseInProgress(false);
        forceInFlight = false;
    }, willFreeze ? 100 : 0);
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
        pendingReparse = false;
        forceReparse(path, /*forceFresh=*/ false);
        return;
    }
    if (pendingReparse) {
        if (Date.now() - lastReparseAtMs >= DEBOUNCE_MS) {
            pendingReparse = false;
            forceReparse(path, /*forceFresh=*/ true);
        }
        return;
    }
    if (path === "" || !fileExistsSafe(path)) return;
    const cached = parseImportJsonBlocking(path);
    if (cached.parsed !== lastParsedRef) propagate(path, cached);
}
