/// <reference types="../../../CTAutocomplete" />

import type { ParseResult } from "htsw";
import type { Importable } from "htsw/types";

import {
    getImportJsonPath,
    setParseInProgress,
    setParsedResult,
} from "../state";
import { addRecent } from "../persistence/recents";
import {
    getParseAt,
    markParseStale,
    parseImportJsonBlocking,
    touchParseCacheMtime,
    type CachedParse,
} from "./parses";
import { javaType } from "../lib/java";

/**
 * `reparse` is a thin DRIVER over the single parse authority,
 * `parseImportJsonBlocking` (parses.ts). It owns no parsing, snapshotting, or
 * mtime-watching of its own — that all lives in `parses.ts` /
 * `parseSnapshot.ts`, behind one fingerprint-based freshness check shared
 * with the Importables tree. This driver only:
 *   - tracks which import.json is active and debounces explicit reloads,
 *   - polls the authority when the overlay is visible,
 *   - propagates a changed parse into global state for the active import.json.
 */

function fileExistsSafe(path: string): boolean {
    try {
        const Files = javaType("java.nio.file.Files");
        const Paths = javaType("java.nio.file.Paths");
        return Files.exists(Paths.get(String(path)));
    } catch (_e) {
        return false;
    }
}

// ── driver state ──────────────────────────────────────────────────────
let lastSeenPath = "";
let lastParsedRef: ParseResult<Importable[]> | null = null;
let forceInFlight = false;

export function reparseNow(): void {
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
 * marks the cached parse stale so the authority re-reads disk now instead of
 * waiting out its settle throttle (used after an export or an explicit reload). Raises
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
    if (forceFresh) markParseStale(path);
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
        forceReparse(path, /*forceFresh=*/ false);
        return;
    }
    if (path === "" || !fileExistsSafe(path)) return;
    const cached = parseImportJsonBlocking(path);
    if (cached.parsed !== lastParsedRef) propagate(path, cached);
}
