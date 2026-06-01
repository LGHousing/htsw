/// <reference types="../../../CTAutocomplete" />

import { ParseResult, parseImportablesResult, SourceMap } from "htsw";
import type { Importable } from "htsw/types";

import { FileSystemFileLoader } from "../../utils/files";
import { getMtimeMs, javaType } from "../lib/java";
import { invalidateKnowledgeOverlayForParse } from "./knowledgeOverlay";
import {
    hasSubList,
    importableSourcePath,
    importableSubListPath,
    type SubListKind,
} from "./importablePaths";
import {
    buildLiteParseResult,
    loadSnapshot,
    saveSnapshot,
    snapshotIsCurrent,
} from "./parseSnapshot";

const SUB_LIST_KINDS: SubListKind[] = [
    "onEnterActions",
    "onExitActions",
    "leftClickActions",
    "rightClickActions",
];

/**
 * Build the full mtime fingerprint for a parsed import.json — matches
 * what `refreshWatchedMtimes` in reparse.ts watches: the import.json
 * itself, every importable's primary source file, its smart-source
 * resolution (e.g. .snbt for ITEM), and every sub-list path
 * (REGION onEnter/onExit, ITEM left/right-click).
 *
 * Shared between the two snapshot-save sites so a snapshot written by
 * the Explore tree walker invalidates on the same edits as one written
 * by the main reparse path.
 */
function buildParseFingerprint(
    importJsonPath: string,
    importJsonMtime: number,
    parsed: ParseResult<Importable[]>
): { [path: string]: number } {
    const out: { [path: string]: number } = {};
    out[importJsonPath] = importJsonMtime;
    const add = (p: string | undefined): void => {
        if (p === undefined || out[p] !== undefined) return;
        out[p] = getMtimeMs(p);
    };
    for (let i = 0; i < parsed.value.length; i++) {
        const imp = parsed.value[i];
        add(parsed.gcx.sourceFiles.get(imp));
        add(importableSourcePath(imp, parsed));
        for (let j = 0; j < SUB_LIST_KINDS.length; j++) {
            const kind = SUB_LIST_KINDS[j];
            if (!hasSubList(imp, kind)) continue;
            add(importableSubListPath(imp, kind, parsed));
        }
    }
    return out;
}

/**
 * Per-file `import.json` parse cache. Lets the Explore tree show
 * importables from any number of import.jsons simultaneously, and lets
 * the dynamic queue resolve `QueueItem`s back to the parsed importable
 * objects regardless of which import.json they originated from.
 *
 * Cache is keyed by canonical absolute path (forward slashes, normalized)
 * so the same file referred to via two different relative paths shares a
 * single entry. Mtime-based staleness — a re-parse happens automatically
 * when the file changes on disk.
 */

export type CachedParse = {
    /** Absolute, forward-slashed, normalized path. Map key. */
    canonicalPath: string;
    /** Whatever string the caller originally handed us — kept for re-parse. */
    rawPath: string;
    /** `Files.getLastModifiedTime(...).toMillis()` at last parse. */
    mtime: number;
    parsed: ParseResult<Importable[]> | null;
    /** Non-null when the parse threw — e.g. malformed JSON. */
    error: string | null;
};

export function canonicalPath(p: string): string {
    if (!p) return p;
    try {
        const Paths = javaType("java.nio.file.Paths");
        return String(Paths.get(String(p)).toAbsolutePath().normalize().toString())
            .replace(/\\/g, "/");
    } catch (_e) {
        return p.replace(/\\/g, "/");
    }
}

const cache = new Map<string, CachedParse>();

/**
 * Parse `rawPath` if not cached or if the file changed on disk. Returns
 * the cached parse either way (with `parsed: null + error: ...` on
 * failure). Safe to call from every render — the underlying work only
 * runs when the mtime has actually changed.
 */
export function parseImportJsonAt(rawPath: string): CachedParse {
    const canon = canonicalPath(rawPath);
    const mtime = getMtimeMs(canon);
    const existing = cache.get(canon);
    if (existing !== undefined && existing.mtime === mtime) return existing;

    // Disk snapshot fast path: avoids a full htsw parse when the
    // import.json + every referenced .htsl still has the recorded
    // mtime. Critical for the Explore tree walker — without it,
    // discovering each large import.json freezes the main thread for
    // its full parse cost on first sighting per session, even though
    // `reparseImportJson` already used the snapshot.
    let parsed: ParseResult<Importable[]> | null = null;
    let error: string | null = null;
    const snapshot = loadSnapshot(canon);
    if (snapshot !== null && snapshotIsCurrent(snapshot)) {
        parsed = buildLiteParseResult(snapshot);
    } else {
        const sm = new SourceMap(new FileSystemFileLoader());
        try {
            parsed = parseImportablesResult(sm, rawPath);
        } catch (e) {
            const msg = e && (e as { message?: string }).message
                ? (e as { message: string }).message
                : String(e);
            error = msg;
        }
        // Save snapshot so the next session's tree walker (and the
        // main reparse path) can skip this parse. Use the full
        // fingerprint shared with refreshWatchedMtimes so edits to
        // sub-list .htsl files (REGION enter/exit, ITEM click actions)
        // invalidate just as they do in the main reparse path. Errored
        // parses are not snapshotted — they must re-parse fully so the
        // import gate sees real, span-bearing diagnostics.
        if (parsed !== null && !parsed.gcx.isFailed()) {
            const fingerprint = buildParseFingerprint(canon, mtime, parsed);
            saveSnapshot(canon, parsed, fingerprint);
        }
    }
    const entry: CachedParse = {
        canonicalPath: canon,
        rawPath,
        mtime,
        parsed,
        error,
    };
    cache.set(canon, entry);
    if (parsed !== null) invalidateKnowledgeOverlayForParse(parsed);
    return entry;
}

/** Look up a previously-parsed import.json by canonical path. */
export function getParseAt(path: string): CachedParse | null {
    const canon = canonicalPath(path);
    return cache.get(canon) ?? null;
}

/**
 * Mark the cache entry's mtime as the file's current mtime, without
 * re-parsing. Use after an in-place mutation of the cached parse that
 * mirrors an on-disk edit, so the mtime check in `parseImportJsonAt`
 * doesn't force a full re-parse the next time it's called.
 */
export function touchParseCacheMtime(rawPath: string): void {
    const canon = canonicalPath(rawPath);
    const existing = cache.get(canon);
    if (existing === undefined) return;
    existing.mtime = getMtimeMs(canon);
}

/**
 * Inject a parse result into the cache. Used by the main reparse path so
 * the explore tree's mtime-keyed cache doesn't redo the same parse the
 * global `parsedResult` just finished.
 */
export function updateParseCache(rawPath: string, result: ParseResult<Importable[]>): void {
    const canon = canonicalPath(rawPath);
    const mtime = getMtimeMs(canon);
    cache.set(canon, {
        canonicalPath: canon,
        rawPath,
        mtime,
        parsed: result,
        error: null,
    });
    invalidateKnowledgeOverlayForParse(result);
}
/**
 * Iterate every parsed import.json. Used by the queue layer to find a
 * `QueueItem`'s importable when only its source path is known.
 */
export function forEachCachedParse(cb: (entry: CachedParse) => void): void {
    for (const v of cache.values()) cb(v);
}
