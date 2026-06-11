/// <reference types="../../../CTAutocomplete" />

/**
 * On-disk cache of `parseImportablesResult` output, keyed by the
 * import.json file path. Lets the GUI populate instantly on `/ct reload`
 * for projects whose source files haven't changed since the last full
 * parse — the htsw parse for a 300+ file project takes ~1s and blocks
 * the main thread; loading a snapshot is a single JSON read.
 *
 * The snapshot stores `value` (the parsed `Importable[]`), importable
 * source paths, and sub-list source paths. Spans and diagnostics are NOT
 * persisted — the lite ParseResult exposes empty
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
 *
 * Snapshots are also stamped with the writing build's bundle mtime and
 * rejected by any other build: a snapshot stores parser OUTPUT, so a
 * parser change must invalidate it even when no source file changed.
 * Without this, a snapshot written by an old build keeps serving
 * importables in the old build's dialect forever — /ct reload, rebuilds,
 * and knowledge-cache deletes never touch it.
 */

import {
    GlobalCtxt,
    SourceMap,
    SpanTable,
    type ParseResult,
} from "htsw";
import type { Importable } from "htsw/types";

import { MODULE_DIR } from "../../autoUpdate";
import { FileSystemFileLoader } from "../../utils/fileLoaders";
import { ensureParentDirs } from "../../utils/filesystem";
import { getMtimeMs } from "../lib/java";
import { memoizedImportableHash, seedImportableHash } from "../../importCache/status";

const SNAPSHOT_DIR = "./htsw/.parse-snapshots";
const MODULE_BUNDLE = MODULE_DIR + "/index.js";
// Captured at load so it identifies the build that is RUNNING. Reading it
// at save time instead would stamp snapshots with a freshly-deployed
// bundle's mtime while the old parser is still executing, making its
// output pass validation after the reload. 0 when the bundle isn't at the
// standard path (renamed dev install) — then snapshots skip the check.
const RUNNING_BUNDLE_MTIME = getMtimeMs(MODULE_BUNDLE);

type Snapshot = {
    version: 5;
    importJsonPath: string;
    // Deployed-bundle mtime of the build that wrote this snapshot. Kept
    // separate from `fingerprint` on purpose: parses.ts reuses the
    // fingerprint for its periodic freshness re-stat, and a mid-session
    // redeploy must not throw the running session into a reparse loop —
    // the build check only matters once, at load.
    bundleMtime: number;
    fingerprint: { [path: string]: number };
    importables: Importable[];
    sourcePaths: (string | null)[];
    subListPaths: Array<{ [kind: string]: string }>;
    // importableHash per importable, index-aligned with `importables`. Persisted
    // so a reload reuses them instead of re-hashing every action tree.
    hashes: string[];
};

const SUB_LIST_KINDS = [
    "onEnterActions",
    "onExitActions",
    "leftClickActions",
    "rightClickActions",
] as const;
type SubListKind = (typeof SUB_LIST_KINDS)[number];

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
        if (parsed.version !== 5) return null;
        if (parsed.importJsonPath !== importJsonPath) return null;
        // A snapshot stores parser OUTPUT, so it's only valid for the build
        // that wrote it. 0 on either side = bundle not at the standard path;
        // fail open like before this check existed.
        if (
            typeof parsed.bundleMtime !== "number" ||
            (parsed.bundleMtime !== 0 &&
                RUNNING_BUNDLE_MTIME !== 0 &&
                parsed.bundleMtime !== RUNNING_BUNDLE_MTIME)
        ) {
            return null;
        }
        if (!Array.isArray(parsed.importables)) return null;
        if (!Array.isArray(parsed.sourcePaths)) return null;
        if (!Array.isArray(parsed.subListPaths)) return null;
        if (!Array.isArray(parsed.hashes)) return null;
        if (parsed.importables.length !== parsed.sourcePaths.length) return null;
        if (parsed.subListPaths.length !== parsed.importables.length) return null;
        if (parsed.hashes.length !== parsed.importables.length) return null;
        if (parsed.fingerprint === null || typeof parsed.fingerprint !== "object" || Array.isArray(parsed.fingerprint)) return null;
        return parsed;
    } catch (_e) {
        return null;
    }
}

function subListOf(imp: Importable, kind: SubListKind): readonly object[] | undefined {
    if (kind === "onEnterActions" && imp.type === "REGION") {
        return imp.onEnterActions;
    }
    if (kind === "onExitActions" && imp.type === "REGION") {
        return imp.onExitActions;
    }
    if (kind === "leftClickActions" && imp.type === "ITEM") {
        return imp.leftClickActions;
    }
    if (kind === "rightClickActions" && imp.type === "ITEM") {
        return imp.rightClickActions;
    }
    return undefined;
}

function pathFromSpan(
    result: ParseResult<Importable[]>,
    key: object
): string | undefined {
    try {
        const span = result.gcx.spans.get(key);
        return result.gcx.sourceMap.getFileByPos(span.start).path;
    } catch (_e) {
        return undefined;
    }
}

function actionPathFromFieldSpan(
    result: ParseResult<Importable[]>,
    imp: Importable,
    kind: SubListKind
): string | undefined {
    try {
        const span = result.gcx.spans.getField(imp as any, kind);
        const file = result.gcx.sourceMap.getFileByPos(span.start);
        const start = span.start - file.startPos;
        const end = span.end - file.startPos;
        const raw = file.src.slice(start, end);
        const value = JSON.parse(raw);
        if (typeof value !== "string") return undefined;
        return result.gcx.sourceMap.fileLoader.resolvePath(
            result.gcx.sourceMap.fileLoader.getParentPath(file.path),
            value
        );
    } catch (_e) {
        return undefined;
    }
}

function subListPath(
    result: ParseResult<Importable[]>,
    imp: Importable,
    kind: SubListKind
): string | undefined {
    const list = subListOf(imp, kind);
    if (list === undefined) return undefined;
    if (list.length === 0) return actionPathFromFieldSpan(result, imp, kind);
    return pathFromSpan(result, list[0]);
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
    const subListPaths: Array<{ [kind: string]: string }> = [];
    for (let i = 0; i < result.value.length; i++) {
        const imp = result.value[i];
        const sp = result.gcx.sourceFiles.get(imp);
        sourcePaths.push(sp ?? null);
        const subLists: { [kind: string]: string } = {};
        for (let j = 0; j < SUB_LIST_KINDS.length; j++) {
            const kind = SUB_LIST_KINDS[j];
            const path = subListPath(result, imp, kind);
            if (path !== undefined) subLists[kind] = path;
        }
        subListPaths.push(subLists);
    }
    const fingerprint: { [path: string]: number } = {};
    for (const k in watchedMtimes) fingerprint[k] = watchedMtimes[k];
    const snapshot: Snapshot = {
        version: 5,
        importJsonPath,
        bundleMtime: RUNNING_BUNDLE_MTIME,
        fingerprint,
        importables: result.value,
        sourcePaths,
        subListPaths,
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
 * rebuilt from `sourcePaths` / `subListPaths` so watching and source-path
 * resolution work unchanged.
 */
export function buildLiteParseResult(snapshot: Snapshot): ParseResult<Importable[]> {
    const sm = new SourceMap(new FileSystemFileLoader());
    const gcx = new GlobalCtxt(sm, snapshot.importJsonPath);
    const sourceFiles = gcx.sourceFiles as unknown as Map<object, string>;
    for (let i = 0; i < snapshot.importables.length; i++) {
        const path = snapshot.sourcePaths[i];
        if (path !== null && path !== undefined) {
            gcx.sourceFiles.set(snapshot.importables[i], path);
        }
        const subLists = snapshot.subListPaths[i];
        for (let j = 0; j < SUB_LIST_KINDS.length; j++) {
            const kind = SUB_LIST_KINDS[j];
            const subList = subListOf(snapshot.importables[i], kind);
            const subPath = subLists[kind];
            if (subList !== undefined && subPath !== undefined) {
                sourceFiles.set(subList, subPath);
            }
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
