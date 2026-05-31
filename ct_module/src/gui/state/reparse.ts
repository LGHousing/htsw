/// <reference types="../../../CTAutocomplete" />

import { SourceMap, parseImportablesResult, htsl } from "htsw";

import { FileSystemFileLoader } from "../../utils/files";
import { scheduleKnowledgeBuild } from "./knowledgeBuild";
import {
    getHousingUuid,
    getImportJsonPath,
    getParsedResult,
    setImportJsonPath,
    setKnowledgeRows,
    setParseInProgress,
    setParsedResult,
} from "./index";
import { addRecent, getRecents } from "./recents";
import { updateParseCache } from "./parses";
import { allReferencedPaths } from "./importablePaths";
import {
    buildLiteParseResult,
    deleteSnapshot,
    loadSnapshot,
    saveSnapshot,
    snapshotExists,
    snapshotIsCurrent,
} from "./parseSnapshot";
import { getMtimeMs, javaType } from "../lib/java";

let lastParseTiming: ParseTiming | null = null;

export type ParseTiming = {
    path: string;
    snapshotLoadMs: number;
    snapshotValidateMs: number;
    snapshotHit: boolean;
    fullParseMs: number | null;
    innerParseMs: number | null;
    innerCheckMs: number | null;
    fileCount: number | null;
    cacheHits: number | null;
    fileReadMs: number | null;
    lexParseMs: number | null;
    typeflowMs: number | null;
    importJsonMs: number | null;
    totalMs: number;
};

export function getLastParseTiming(): ParseTiming | null {
    return lastParseTiming;
}

export function invalidateParseSnapshot(): boolean {
    const path = getImportJsonPath();
    if (path.length === 0) return false;
    htsl.clearHtslCache();
    return deleteSnapshot(path);
}


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

export function reparseNow(): void {
    pendingReparse = false;
    runReparseDeferred();
}

/**
 * Mark the given file as already in sync with what reparse would observe.
 * Use this when something else (e.g. an in-place metadata edit) has
 * already updated both the disk file AND the in-memory parsed state, so
 * the mtime watcher shouldn't trigger a redundant reparse on next poll.
 */
export function markPathInSync(path: string): void {
    if (watchedMtimes[path] === undefined) return;
    watchedMtimes[path] = getMtimeMs(path);
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

    const t0 = Date.now();

    const snapshot = loadSnapshot(path);
    const t1 = Date.now();

    if (snapshot !== null && snapshotIsCurrent(snapshot)) {
        const t2 = Date.now();
        const lite = buildLiteParseResult(snapshot);
        setParsedResult(lite);
        updateParseCache(path, lite);
        addRecent(path);
        const tEnd = Date.now();
        lastParseTiming = {
            path,
            snapshotLoadMs: t1 - t0,
            snapshotValidateMs: t2 - t1,
            snapshotHit: true,
            fullParseMs: null,
            innerParseMs: null,
            innerCheckMs: null,
            fileCount: null,
            cacheHits: null,
            fileReadMs: null,
            lexParseMs: null,
            typeflowMs: null,
            importJsonMs: null,
            totalMs: tEnd - t0,
        };
        scheduleDeferredPostParse(lite, path, /*persist=*/ false);
        return;
    }

    const tPreParse = Date.now();
    const sm = new SourceMap(new FileSystemFileLoader());
    try {
        const result = parseImportablesResult(sm, path);
        const tParsed = Date.now();
        setParsedResult(result);
        updateParseCache(path, result);
        addRecent(path);
        const tm = result.timingMs;
        lastParseTiming = {
            path,
            snapshotLoadMs: t1 - t0,
            snapshotValidateMs: tPreParse - t1,
            snapshotHit: false,
            fullParseMs: tParsed - tPreParse,
            innerParseMs: tm?.parseMs ?? null,
            innerCheckMs: tm?.checkMs ?? null,
            fileCount: tm?.fileCount ?? null,
            cacheHits: tm?.cacheHits ?? null,
            fileReadMs: tm?.fileReadMs ?? null,
            lexParseMs: tm?.lexParseMs ?? null,
            typeflowMs: tm?.typeflowMs ?? null,
            importJsonMs: tm?.importJsonMs ?? null,
            totalMs: tParsed - t0,
        };
        scheduleDeferredPostParse(result, path, /*persist=*/ true);
        return;
    } catch (_err) {
        const tFail = Date.now();
        lastParseTiming = {
            path,
            snapshotLoadMs: t1 - t0,
            snapshotValidateMs: tPreParse - t1,
            snapshotHit: false,
            fullParseMs: tFail - tPreParse,
            innerParseMs: null,
            innerCheckMs: null,
            fileCount: null,
            cacheHits: null,
            fileReadMs: null,
            lexParseMs: null,
            typeflowMs: null,
            importJsonMs: null,
            totalMs: tFail - t0,
        };
        setParsedResult(null);
        setKnowledgeRows([]);
    }
    refreshWatchedMtimes();
}

/**
 * Off-critical-path work after a parse. Knowledge rows go through the shared
 * tick-driven builder (knowledgeBuild) — no separate batch loop here. The
 * watched-mtime refresh + snapshot persist run once, generation-guarded so a
 * newer reparse supersedes a stale one. All of this lags the importables list
 * (set synchronously in reparseImportJson) by design.
 */
let postParseGeneration = 0;

function scheduleDeferredPostParse(
    result: import("htsw").ParseResult<import("htsw/types").Importable[]>,
    path: string,
    persist: boolean
): void {
    const gen = ++postParseGeneration;
    const housingUuid = getHousingUuid();
    if (housingUuid === null) {
        scheduleKnowledgeBuild("", []);
    } else {
        scheduleKnowledgeBuild(housingUuid, result.value);
    }
    setTimeout(() => {
        if (gen !== postParseGeneration) return;
        refreshWatchedMtimes();
        if (persist) saveSnapshot(path, result, watchedMtimes);
    }, 0);
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
