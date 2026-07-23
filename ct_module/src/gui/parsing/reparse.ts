/// <reference types="../../../CTAutocomplete" />

import type { ImportablesParseResult } from "htsw";

import { getImportJsonPath } from "../state";
import { addRecent } from "../persistence/recents";
import {
    canonicalPath,
    requestParse,
    touchParseCacheMtime,
    type CachedParse,
} from "./parses";
import { javaType } from "../lib/java";
import { autoTrackRefresh } from "../autoTrack";

/**
 * `reparse` is a thin DRIVER over the single parse authority,
 * `parseImportJsonBlocking` (parses.ts). It owns no parsing, snapshotting, or
 * mtime-watching of its own — that all lives in `parses.ts` /
 * `parseSnapshot.ts`, behind one fingerprint-based freshness check shared
 * with the Projects tree. This driver only:
 *   - tracks which import.json is active and debounces explicit reloads,
 *   - polls the authority when the overlay is visible,
 *   - runs side effects when the selected import.json gets a changed parse.
 */

function fileExistsSafe(path: string): boolean {
    try {
        const Files = javaType("java.nio.file.Files");
        const Paths = javaType("java.nio.file.Paths");
        return Files.exists(Paths.get(path));
    } catch (_e) {
        return false;
    }
}

// ── driver state ──────────────────────────────────────────────────────
let lastSeenPath = "";
let lastParsedRef: ImportablesParseResult | null = null;

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
    if (cached.parsed === null) return;
    addRecent(path);
    autoTrackRefresh();
}

export function handleCompletedParse(cached: CachedParse): void {
    const path = getImportJsonPath();
    if (
        path !== "" &&
        canonicalPath(path) === cached.canonicalPath &&
        cached.parsed !== lastParsedRef
    ) {
        propagate(path, cached);
        return;
    }
    autoTrackRefresh();
}

/**
 * Tick hook. Loads a newly-selected import.json, then in steady state polls
 * the parse authority and propagates whenever it hands back a new parse.
 * No mtime bookkeeping here — the authority owns freshness.
 */
export function tickReparse(): void {
    const path = getImportJsonPath();
    if (path !== lastSeenPath) {
        lastSeenPath = path;
        lastParsedRef = null;
    }
    if (path === "" || !fileExistsSafe(path)) return;
    const cached = requestParse(path);
    if (cached === null) return;
    if (cached.parsed !== lastParsedRef) propagate(path, cached);
}
