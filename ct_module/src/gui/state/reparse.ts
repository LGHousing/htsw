/// <reference types="../../../CTAutocomplete" />

import { SourceMap, parseImportablesResult } from "htsw";

import { FileSystemFileLoader } from "../../utils/files";
import { buildCacheStatusRows } from "../../importCache/status";
import {
    appendKnowledgeRows,
    getHousingUuid,
    getImportJsonPath,
    getParsedResult,
    setImportJsonPath,
    setKnowledgeRows,
    setParseInProgress,
    setParsedResult,
} from "./index";
import { addRecent, getRecents } from "./recents";
import { allReferencedPaths } from "./importablePaths";
import {
    buildLiteParseResult,
    loadSnapshot,
    saveSnapshot,
    snapshotExists,
    snapshotIsCurrent,
} from "./parseSnapshot";
import { getMtimeMs, javaType } from "../lib/java";


let lastReparseAtMs = 0;
let lastMtimeCheckAt = 0;
let pendingReparse = false;
let lastSeenPath = "";
// Mtime snapshot per watched file (the import.json + every htsl source it
// referenced on the last successful parse). When any of these change on
// disk we reparse so knowledge dots / right-pane / live importer reflect
// the edit immediately.
const watchedMtimes: { [path: string]: number } = {};
const DEBOUNCE_MS = 300;
const MTIME_CHECK_INTERVAL_MS = 500;
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


export function scheduleReparse(): void {
    pendingReparse = true;
    lastReparseAtMs = Date.now();
}

function watch(path: string | undefined): void {
    if (path === undefined) return;
    if (watchedMtimes[path] !== undefined) return;
    watchedMtimes[path] = getMtimeMs(path);
}

function refreshWatchedMtimes(): void {
    for (const k in watchedMtimes) delete watchedMtimes[k];
    const path = getImportJsonPath();
    const parsed = getParsedResult();
    const paths = allReferencedPaths(path, parsed);
    for (let i = 0; i < paths.length; i++) {
        watch(paths[i]);
    }
}

export function reparseImportJson(): void {
    pendingReparse = false;
    const path = getImportJsonPath();
    lastSeenPath = path;
    if (!fileExistsSafe(path)) {
        setParsedResult(null);
        setKnowledgeRows([]);
        refreshWatchedMtimes();
        return;
    }

    // Fast path: a previous full parse left a snapshot on disk and
    // every referenced file still has the recorded mtime. Skip the
    // expensive htsw parse (which can freeze for ~1s on 300+-file
    // projects) and populate state from the lite snapshot.
    const snapshot = loadSnapshot(path);
    if (snapshot !== null && snapshotIsCurrent(snapshot)) {
        const lite = buildLiteParseResult(snapshot);
        setParsedResult(lite);
        addRecent(path);
        setKnowledgeRows([]);
        scheduleDeferredPostParse(lite, path, /*persist=*/ false);
        return;
    }

    const sm = new SourceMap(new FileSystemFileLoader());
    try {
        const result = parseImportablesResult(sm, path);
        setParsedResult(result);
        // Any successful parse adds the path to the recents dropdown — covers loads from the
        // file browser, the path input, the recents dropdown itself (re-bumps to top), and
        // auto-discover. Dedup is handled inside addRecent.
        addRecent(path);
        setKnowledgeRows([]);
        scheduleDeferredPostParse(result, path, /*persist=*/ true);
        return;
    } catch (_err) {
        setParsedResult(null);
        setKnowledgeRows([]);
    }
    refreshWatchedMtimes();
}

/**
 * Off-critical-path work that used to run synchronously inside
 * `reparseImportJson`: per-importable hash + cache-status lookup (346
 * file-IO calls on a big project), refreshing the watched-mtime map
 * (another N stats), and persisting the snapshot. Yields between
 * batches via `setTimeout` so the GUI re-renders with the populated
 * importables list before knowledge dots / watching catch up.
 */
function scheduleDeferredPostParse(
    result: import("htsw").ParseResult<import("htsw/types").Importable[]>,
    path: string,
    persist: boolean
): void {
    const housingUuid = getHousingUuid();
    const importables = result.value;
    const BATCH = 40;

    function processBatch(start: number): void {
        if (housingUuid === null || start >= importables.length) {
            // Knowledge dots done (or skipped). Now refresh watched
            // mtimes + persist snapshot — also potentially expensive
            // (N filesystem stats) so it gets its own yield.
            setTimeout(() => {
                refreshWatchedMtimes();
                if (persist) saveSnapshot(path, result, watchedMtimes);
            }, 0);
            return;
        }
        const end = Math.min(importables.length, start + BATCH);
        const slice = importables.slice(start, end);
        const rows = buildCacheStatusRows(housingUuid, slice);
        appendKnowledgeRows(rows);
        setTimeout(() => processBatch(end), 0);
    }

    setTimeout(() => processBatch(0), 0);
}

/**
 * Tick hook: if a reparse was scheduled and the debounce has elapsed, run
 * it. Also catches manual edits to the file: if the path or mtime changed
 * since last parse, reparse without a debounce. Watches all htsl sources
 * referenced by the current parse, not just the import.json — so editing
 * an htsl in VS Code immediately flips the knowledge dot.
 */
// Round-robin slice index for the mtime poll. We can't stat all 300+
// watched files every 500ms — that's a stutter every half-second on
// large projects. Instead we walk through them N at a time across
// successive ticks.
let mtimeCheckSlicePos = 0;
const MTIME_CHECK_SLICE = 40;

function runReparseDeferred(): void {
    // Defer the actual parse off the tick so its synchronous cost
    // doesn't extend the current frame. The user's scroll / input
    // finishes painting; the parse-freeze (if any) lands on a later
    // tick by itself.
    //
    // Show the "Loading…" indicator only when the next parse is likely
    // to actually freeze — i.e. no snapshot on disk for this path. If a
    // snapshot exists, the fast path takes a few ms and the loading UI
    // would just flash. (`snapshotExists` skips the expensive
    // fingerprint validation that `snapshotIsCurrent` does.)
    const path = getImportJsonPath();
    const willLikelyFreeze = !snapshotExists(path);
    if (willLikelyFreeze) setParseInProgress(true);
    setTimeout(() => {
        try {
            reparseImportJson();
        } catch (_e) {
            // state.parseError handles the error path
        }
        if (willLikelyFreeze) setParseInProgress(false);
    }, 0);
}

export function tickReparse(): void {
    if (pendingReparse) {
        // Wait the debounce out — don't disturb the timer. The earlier code
        // re-called scheduleReparse() here when the path differed from
        // lastSeenPath, which reset lastReparseAtMs every tick (~50ms) and
        // prevented the 300ms debounce from ever elapsing.
        if (Date.now() - lastReparseAtMs >= DEBOUNCE_MS) runReparseDeferred();
        return;
    }
    const path = getImportJsonPath();
    if (path !== lastSeenPath) {
        scheduleReparse();
        return;
    }
    if (Date.now() - lastMtimeCheckAt < MTIME_CHECK_INTERVAL_MS) return;
    lastMtimeCheckAt = Date.now();

    // Snapshot the keys so insertion order stays stable across slices
    // even if `watchedMtimes` gets mutated mid-walk by an ongoing
    // reparse. Walking the live object would skip files when the map
    // shrinks.
    const keys: string[] = [];
    for (const k in watchedMtimes) keys.push(k);
    if (keys.length === 0) return;

    if (mtimeCheckSlicePos >= keys.length) mtimeCheckSlicePos = 0;
    const end = Math.min(keys.length, mtimeCheckSlicePos + MTIME_CHECK_SLICE);
    for (let i = mtimeCheckSlicePos; i < end; i++) {
        const watched = keys[i];
        const m = getMtimeMs(watched);
        if (m !== 0 && m !== watchedMtimes[watched]) {
            mtimeCheckSlicePos = 0;
            runReparseDeferred();
            return;
        }
    }
    mtimeCheckSlicePos = end;
}
