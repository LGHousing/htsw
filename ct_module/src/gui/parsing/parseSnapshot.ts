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
 * versions of those. This is sound because snapshots are only written
 * for parses with no errors (see the `isFailed()` guards at the
 * `saveSnapshot` call sites): a clean parse has no diagnostics, so an
 * empty `diagnostics` is the correct value, and an import gated on
 * `gcx.isFailed()` stays accurate. A file that parses WITH errors is
 * never snapshotted, so it always falls through to a full parse — which
 * carries real spans + sourceMap and renders through the language
 * diagnostic system (file:line:column + source snippet).
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

import { FileSystemFileLoader } from "../../utils/fileLoaders";
import { ensureParentDirs } from "../../utils/filesystem";
import { getMtimeMs } from "../lib/java";
import { memoizedImportableHash, seedImportableHash } from "../../importCache/status";

const SNAPSHOT_DIR = "./htsw/.parse-snapshots";

type Snapshot = {
    version: 3;
    importJsonPath: string;
    fingerprint: { [path: string]: number };
    importables: Importable[];
    sourcePaths: (string | null)[];
    // importableHash per importable, index-aligned with `importables`. Persisted
    // so a reload reuses them instead of re-hashing every action tree.
    hashes: string[];
};

function hashPathKey(filePath: string): string {
    const norm = filePath.split("\\").join("/").toLowerCase();
    let hash = 0;
    for (let i = 0; i < norm.length; i++) {
        hash = ((hash << 5) - hash + norm.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(16);
}

function snapshotFileFor(importJsonPath: string): string {
    return `${SNAPSHOT_DIR}/${hashPathKey(importJsonPath)}.json`;
}


/**
 * Cheap existence check — does NOT validate fingerprint. Used to decide
 * whether the next reparse is likely to hit the fast path (skip the
 * "Loading…" indicator) without paying the cost of `snapshotIsCurrent`'s
 * 300+ filesystem stats.
 */
export function snapshotExists(importJsonPath: string): boolean {
    return FileLib.exists(snapshotFileFor(importJsonPath));
}

export function loadSnapshot(importJsonPath: string): Snapshot | null {
    const p = snapshotFileFor(importJsonPath);
    if (!FileLib.exists(p)) return null;
    try {
        const raw = String(FileLib.read(p) ?? "");
        if (raw.length === 0) return null;
        const parsed = JSON.parse(raw) as Snapshot;
        if (parsed.version !== 3) return null;
        if (parsed.importJsonPath !== importJsonPath) return null;
        if (!Array.isArray(parsed.importables)) return null;
        if (!Array.isArray(parsed.sourcePaths)) return null;
        if (!Array.isArray(parsed.hashes)) return null;
        if (parsed.importables.length !== parsed.sourcePaths.length) return null;
        if (parsed.hashes.length !== parsed.importables.length) return null;
        if (parsed.fingerprint === null || typeof parsed.fingerprint !== "object" || Array.isArray(parsed.fingerprint)) return null;
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

export function deleteSnapshot(importJsonPath: string): boolean {
    const p = snapshotFileFor(importJsonPath);
    if (!FileLib.exists(p)) return false;
    try {
        const Files = Java.type("java.nio.file.Files");
        const Paths = Java.type("java.nio.file.Paths");
        Files.deleteIfExists(Paths.get(String(p)));
        return true;
    } catch (_e) {
        return false;
    }
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
        version: 3,
        importJsonPath,
        fingerprint,
        importables: result.value,
        sourcePaths,
        hashes: result.value.map(memoizedImportableHash),
    };
    try {
        const out = snapshotFileFor(importJsonPath);
        ensureParentDirs(out);
        FileLib.write(out, JSON.stringify(snapshot), true);
    } catch (_e) {
        // Cache is best-effort; failures don't disturb the parse path.
    }
}

/**
 * Constructs a lite `ParseResult<Importable[]>` from a cached snapshot.
 * `spans` and `gcx.diagnostics` are empty — sound because only clean
 * parses are snapshotted (see this module's header), so a snapshot
 * always represents a zero-diagnostic parse. `gcx.sourceFiles` is
 * rebuilt from `sourcePaths` so watching and source-path resolution
 * work unchanged.
 */
export function buildLiteParseResult(snapshot: Snapshot): ParseResult<Importable[]> {
    const sm = new SourceMap(new FileSystemFileLoader());
    const gcx = new GlobalCtxt(sm, snapshot.importJsonPath);
    for (let i = 0; i < snapshot.importables.length; i++) {
        const path = snapshot.sourcePaths[i];
        if (path !== null && path !== undefined) {
            gcx.sourceFiles.set(snapshot.importables[i], path);
        }
        seedImportableHash(snapshot.importables[i], snapshot.hashes[i]);
    }
    return {
        value: snapshot.importables,
        spans: new SpanTable(),
        diagnostics: [],
        gcx,
    };
}
