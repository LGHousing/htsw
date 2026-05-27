/// <reference types="../../../CTAutocomplete" />

/**
 * On-disk cache of `parseImportablesResult` output, keyed by the
 * import.json file path. Lets the GUI populate instantly on `/ct reload`
 * for projects whose source files haven't changed since the last full
 * parse — the htsw parse for a 300+ file project takes ~1s and blocks
 * the main thread; loading a snapshot is a single JSON read.
 *
 * The snapshot stores `value` (the parsed `Importable[]`) and the
 * `sourceFiles` map as a parallel `sourcePaths` array. Spans and
 * diagnostics are NOT persisted — the lite ParseResult exposes empty
 * versions of those. The few consumers that need spans (live import,
 * raw-view rendering of nested actions) do their own per-file parse via
 * `parseHtslFile` and aren't affected.
 *
 * Validity is checked by mtime fingerprint: every file the previous
 * parse referenced (import.json + every linked .htsl) must match its
 * recorded mtime, or we fall through to a full parse.
 */

import {
    GlobalCtxt,
    SourceMap,
    SpanTable,
    type ParseResult,
} from "htsw";
import type { Importable } from "htsw/types";

import { FileSystemFileLoader } from "../../utils/files";
import { ensureParentDirs } from "../../utils/filesystem";
import { getMtimeMs } from "../lib/java";

const SNAPSHOT_DIR = "./htsw/.parse-snapshots";

type Snapshot = {
    version: 1;
    importJsonPath: string;
    fingerprint: { [path: string]: number };
    importables: Importable[];
    sourcePaths: (string | null)[];
};

function snapshotPath(importJsonPath: string): string {
    const key = importJsonPath.split("\\").join("/").toLowerCase();
    let hash = 0;
    for (let i = 0; i < key.length; i++) {
        hash = ((hash << 5) - hash + key.charCodeAt(i)) | 0;
    }
    const hex = (hash >>> 0).toString(16);
    return `${SNAPSHOT_DIR}/${hex}.json`;
}


/**
 * Cheap existence check — does NOT validate fingerprint. Used to decide
 * whether the next reparse is likely to hit the fast path (skip the
 * "Loading…" indicator) without paying the cost of `snapshotIsCurrent`'s
 * 300+ filesystem stats.
 */
export function snapshotExists(importJsonPath: string): boolean {
    return FileLib.exists(snapshotPath(importJsonPath));
}

export function loadSnapshot(importJsonPath: string): Snapshot | null {
    const p = snapshotPath(importJsonPath);
    if (!FileLib.exists(p)) return null;
    try {
        const raw = String(FileLib.read(p) ?? "");
        if (raw.length === 0) return null;
        const parsed = JSON.parse(raw) as Snapshot;
        if (parsed.version !== 1) return null;
        if (parsed.importJsonPath !== importJsonPath) return null;
        if (!Array.isArray(parsed.importables)) return null;
        if (!Array.isArray(parsed.sourcePaths)) return null;
        if (parsed.importables.length !== parsed.sourcePaths.length) return null;
        return parsed;
    } catch (_e) {
        return null;
    }
}

/**
 * Returns true when every file in the snapshot's fingerprint still has
 * its recorded mtime on disk. A missing file invalidates the snapshot
 * (the source moved or was deleted; safer to fall through).
 */
export function snapshotIsCurrent(snapshot: Snapshot): boolean {
    for (const p in snapshot.fingerprint) {
        const expected = snapshot.fingerprint[p];
        const actual = getMtimeMs(p);
        if (actual === 0 || actual !== expected) return false;
    }
    return true;
}

export function saveSnapshot(
    importJsonPath: string,
    result: ParseResult<Importable[]>,
    watchedMtimes: { [path: string]: number }
): void {
    const sourcePaths: (string | null)[] = [];
    for (let i = 0; i < result.value.length; i++) {
        const sp = result.gcx.sourceFiles.get(result.value[i]);
        sourcePaths.push(sp ?? null);
    }
    const fingerprint: { [path: string]: number } = {};
    for (const k in watchedMtimes) fingerprint[k] = watchedMtimes[k];
    const snapshot: Snapshot = {
        version: 1,
        importJsonPath,
        fingerprint,
        importables: result.value,
        sourcePaths,
    };
    try {
        const out = snapshotPath(importJsonPath);
        ensureParentDirs(out);
        FileLib.write(out, JSON.stringify(snapshot), true);
    } catch (_e) {
        // Cache is best-effort; failures don't disturb the parse path.
    }
}

/**
 * Constructs a lite `ParseResult<Importable[]>` from a cached snapshot.
 * `spans` is empty and `gcx.diagnostics` is empty — features that need
 * those degrade gracefully (no diagnostic backgrounds, no smart
 * .snbt-source lookups) until the next full parse replaces the state.
 * `gcx.sourceFiles` is rebuilt from `sourcePaths` so watching and
 * source-path resolution work unchanged.
 */
export function buildLiteParseResult(snapshot: Snapshot): ParseResult<Importable[]> {
    const sm = new SourceMap(new FileSystemFileLoader());
    const gcx = new GlobalCtxt(sm, snapshot.importJsonPath);
    for (let i = 0; i < snapshot.importables.length; i++) {
        const path = snapshot.sourcePaths[i];
        if (path !== null && path !== undefined) {
            gcx.sourceFiles.set(snapshot.importables[i], path);
        }
    }
    return {
        value: snapshot.importables,
        spans: new SpanTable(),
        diagnostics: [],
        gcx,
    };
}
