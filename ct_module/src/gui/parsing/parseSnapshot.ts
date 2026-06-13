/// <reference types="../../../CTAutocomplete" />

/**
 * On-disk cache of `parseImportablesResult` output, keyed by the
 * import.json file path. Lets the GUI populate instantly on `/ct reload`
 * for projects whose source files haven't changed since the last full
 * parse — the htsw parse for a 300+ file project takes ~1s and blocks
 * the main thread; loading a snapshot is a single JSON read.
 *
 * The snapshot stores `value` (the parsed `Importable[]`), importable
 * source paths, sub-list source paths, and the parse's diagnostics with
 * their spans resolved to file-relative offsets. Restoring rebuilds the
 * diagnostics with REAL spans (loading just the diagnostic-bearing files
 * into the new SourceMap), so `isFailed()`, squiggles, and hover survive
 * the round trip. What does NOT survive is the AST `SpanTable` — span
 * lookups for actions/fields return nothing on a restored parse.
 * `CachedParse.fromSnapshot` says which kind you're holding.
 *
 * Validity is checked by mtime fingerprint: every file the previous
 * parse referenced (import.json + every linked .htsl) must match its
 * recorded mtime, or we fall through to a splice (htsl-only changes) or
 * a full parse.
 *
 * Snapshots are also stamped with the writing build's bundle mtime and
 * rejected by any other build: a snapshot stores parser OUTPUT, so a
 * parser change must invalidate it even when no source file changed.
 * Without this, a snapshot written by an old build keeps serving
 * importables in the old build's dialect forever — /ct reload, rebuilds,
 * and knowledge-cache deletes never touch it.
 */

import {
    Diagnostic,
    GlobalCtxt,
    SourceMap,
    Span,
    SpanTable,
    parseActionsResult,
    items as itemReferences,
    type ImportJsonFileNode,
    type ParseResult,
} from "htsw";
import type { Action, Importable } from "htsw/types";

import { MODULE_DIR } from "../../autoUpdate";
import { FileSystemFileLoader } from "../../utils/fileLoaders";
import { ensureParentDirs } from "../../utils/filesystem";
import { getMtimeMs } from "../lib/java";
import { memoizedImportableHash, seedImportableHash } from "../../importCache/status";
import { importableHash } from "../../importCache";
import { referencedItemNamesInActions } from "../../importables/itemDependencies";
import {
    SUB_LIST_KINDS,
    importableSubListPath,
    subListOf,
    type SubListKind,
} from "./importablePaths";

const SNAPSHOT_DIR = "./htsw/.parse-snapshots";
const MODULE_BUNDLE = MODULE_DIR + "/index.js";
// Captured at load so it identifies the build that is RUNNING. Reading it
// at save time instead would stamp snapshots with a freshly-deployed
// bundle's mtime while the old parser is still executing, making its
// output pass validation after the reload. 0 when the bundle isn't at the
// standard path (renamed dev install) — then snapshots skip the check.
const RUNNING_BUNDLE_MTIME = getMtimeMs(MODULE_BUNDLE);

// gcx.fileTree with each importable replaced by its index into the
// snapshot's flat `importables` array — serializing the objects in place
// would store every importable twice.
type SerializedFileNode = {
    path: string;
    importables: number[];
    includes: SerializedFileNode[];
};

/**
 * A diagnostic with each span resolved to file-relative offsets at save
 * time. Restoring loads the referenced files into the new SourceMap and
 * rebuilds REAL spans, so squiggles/hover work identically on a restored
 * parse. Offsets can't drift: any change to a referenced file makes the
 * fingerprint stale, which re-derives or discards these entries.
 */
type SnapshotDiagnosticSpan = {
    kind: "primary" | "secondary";
    path: string;
    /** Offsets within the file (NOT SourceMap-global positions). */
    start: number;
    end: number;
    label?: string;
};

type SnapshotDiagnostic = {
    level: Diagnostic["level"];
    message: string;
    spans: SnapshotDiagnosticSpan[];
    notes: string[];
};

type Snapshot = {
    version: 9;
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
    // gcx.houseUuid of the snapshotted parse — the entry file's "houseUuid"
    // binding. Must round-trip, or a snapshot-served session sees every
    // bound file as unbound.
    houseUuid: string | null;
    // gcx.fileTree. Must round-trip, or a snapshot-served session renders
    // the Importables include tree as one flat list.
    fileTree: SerializedFileNode | null;
    // The parse's diagnostics, pre-rendered. Errored parses are snapshotted
    // like clean ones — without this an errored project paid a full parse
    // on every reload, since nothing could restore its failed state.
    diagnostics: SnapshotDiagnostic[];
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
 * "Loading…" indicator) without paying a full fingerprint sweep's
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
        if (parsed.version !== 9) return null;
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
        if (parsed.houseUuid !== null && typeof parsed.houseUuid !== "string") return null;
        if (parsed.fingerprint === null || typeof parsed.fingerprint !== "object" || Array.isArray(parsed.fingerprint)) return null;
        if (parsed.fileTree !== null && typeof parsed.fileTree !== "object") return null;
        if (!Array.isArray(parsed.diagnostics)) return null;
        for (const d of parsed.diagnostics) {
            if (!Array.isArray(d.spans) || !Array.isArray(d.notes)) return null;
        }
        return parsed;
    } catch (_e) {
        return null;
    }
}

export type FingerprintChange = { path: string; mtime: number };

/**
 * Stat every fingerprinted file once and return the entries whose mtime
 * moved (`mtime: 0` = file missing). Empty result = snapshot is current.
 * The one sweep serves both the "serve the snapshot as-is" decision and
 * the splice's "which files changed" question — previously two separate
 * full sweeps.
 */
export function diffSnapshotFingerprint(snapshot: Snapshot): FingerprintChange[] {
    const changed: FingerprintChange[] = [];
    for (const p in snapshot.fingerprint) {
        const actual = getMtimeMs(p);
        if (actual === 0 || actual !== snapshot.fingerprint[p]) {
            changed.push({ path: p, mtime: actual });
        }
    }
    return changed;
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

/**
 * Resolve a diagnostic's spans to file-relative offsets through the
 * (still live) sourceMap, producing the storable form. Unresolvable
 * spans are dropped; the message and level always survive.
 */
function serializeDiagnostic(
    sm: SourceMap,
    diag: Diagnostic
): SnapshotDiagnostic {
    const spans: SnapshotDiagnosticSpan[] = [];
    for (const s of diag.spans) {
        try {
            const file = sm.getFileByPos(s.span.start);
            spans.push({
                kind: s.kind,
                path: file.path,
                start: s.span.start - file.startPos,
                end: s.span.end - file.startPos,
                ...(s.label !== undefined ? { label: s.label } : {}),
            });
        } catch (_e) {
            // Unresolvable span — keep the diagnostic, drop the span.
        }
    }
    return {
        level: diag.level,
        message: diag.message,
        spans,
        notes: diag.subDiagnostics.map((s) => s.message),
    };
}

/**
 * Rebuild a `Diagnostic` from its stored form, loading each span's file
 * into `sm` (only files that actually carry diagnostics get loaded) so
 * the restored spans are real SourceMap positions.
 */
function restoreDiagnostic(sm: SourceMap, stored: SnapshotDiagnostic): Diagnostic {
    const make =
        stored.level === "bug"
            ? Diagnostic.bug
            : stored.level === "error"
              ? Diagnostic.error
              : stored.level === "warning"
                ? Diagnostic.warning
                : stored.level === "help"
                  ? Diagnostic.help
                  : Diagnostic.note;
    const diag = make(stored.message);
    for (const s of stored.spans) {
        let span: Span;
        try {
            const file = sm.getFile(s.path);
            span = new Span(file.startPos + s.start, file.startPos + s.end);
        } catch (_e) {
            continue;
        }
        if (s.kind === "primary") diag.addPrimarySpan(span, s.label);
        else diag.addSecondarySpan(span, s.label);
    }
    for (const note of stored.notes) diag.addSubDiagnostic(Diagnostic.note(note));
    return diag;
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
            const path = importableSubListPath(imp, kind, result);
            if (path !== undefined) subLists[kind] = path;
        }
        subListPaths.push(subLists);
    }
    const fingerprint: { [path: string]: number } = {};
    for (const k in watchedMtimes) fingerprint[k] = watchedMtimes[k];
    const snapshot: Snapshot = {
        version: 9,
        importJsonPath,
        bundleMtime: RUNNING_BUNDLE_MTIME,
        fingerprint,
        importables: result.value,
        sourcePaths,
        subListPaths,
        hashes: result.value.map(memoizedImportableHash),
        houseUuid: result.gcx.houseUuid,
        fileTree: serializeFileTree(result.gcx.fileTree, result.value),
        diagnostics: result.diagnostics.map((d) =>
            serializeDiagnostic(result.gcx.sourceMap, d)
        ),
    };
    writeSnapshotFile(snapshot);
}

function serializeFileTree(
    tree: ImportJsonFileNode | null,
    flat: Importable[]
): SerializedFileNode | null {
    if (tree === null) return null;
    const indexOf = new Map<Importable, number>();
    for (let i = 0; i < flat.length; i++) indexOf.set(flat[i], i);
    const visit = (node: ImportJsonFileNode): SerializedFileNode => {
        const indices: number[] = [];
        for (let i = 0; i < node.importables.length; i++) {
            const idx = indexOf.get(node.importables[i]);
            if (idx !== undefined) indices.push(idx);
        }
        return {
            path: node.path,
            importables: indices,
            includes: node.includes.map(visit),
        };
    };
    return visit(tree);
}

function deserializeFileTree(
    tree: SerializedFileNode | null,
    flat: Importable[]
): ImportJsonFileNode | null {
    if (tree === null) return null;
    const visit = (node: SerializedFileNode): ImportJsonFileNode => {
        const imps: Importable[] = [];
        for (let i = 0; i < node.importables.length; i++) {
            const imp = flat[node.importables[i]];
            if (imp !== undefined) imps.push(imp);
        }
        return {
            path: node.path,
            importables: imps,
            includes: node.includes.map(visit),
        };
    };
    return visit(tree);
}

export function writeSnapshotFile(snapshot: Snapshot): void {
    try {
        const out = snapshotFileFor(snapshot.importJsonPath);
        ensureParentDirs(out);
        FileLib.write(out, JSON.stringify(snapshot), true);
    } catch (_e) {
        // Cache is best-effort; failures don't disturb the parse path.
    }
}

// ── Single-file splice ────────────────────────────────────────────────────

function isHtslPath(p: string): boolean {
    return /\.htsl$/i.test(p);
}

type SpliceTarget = { index: number; prop: "actions" | SubListKind };

/** Every importable slot whose action list is materialized from `path`. */
function spliceTargetsFor(snapshot: Snapshot, path: string): SpliceTarget[] {
    const targets: SpliceTarget[] = [];
    for (let i = 0; i < snapshot.importables.length; i++) {
        const type = snapshot.importables[i].type;
        if (
            snapshot.sourcePaths[i] === path &&
            (type === "FUNCTION" || type === "EVENT")
        ) {
            targets.push({ index: i, prop: "actions" });
        }
        const subLists = snapshot.subListPaths[i];
        for (let j = 0; j < SUB_LIST_KINDS.length; j++) {
            if (subLists[SUB_LIST_KINDS[j]] === path) {
                targets.push({ index: i, prop: SUB_LIST_KINDS[j] });
            }
        }
    }
    return targets;
}

/**
 * The whole-snapshot fingerprint made one `.htsl` edit cost a full project
 * re-parse (~1s main-thread freeze on big projects). When the ONLY stale
 * fingerprint entries are `.htsl` files, re-parse just those files and
 * splice the new action lists into the snapshot — actions are leaves
 * (they reference items; nothing references them), so nothing else in the
 * parse can change.
 *
 * A changed file that parses WITH diagnostics is spliced too, mirroring
 * the full parse: its recovered (possibly partial) actions land in the
 * importable, its diagnostics replace the file's stored ones, and the
 * restored parse reports `isFailed()` accordingly — one broken file
 * doesn't demote the whole project to full parses. What the splice skips
 * is the whole-project check passes, same fidelity as the single-buffer
 * editors.
 *
 * Returns the updated snapshot, or null when a full parse is required:
 * any non-htsl change (import.json / .snbt edits can move the item
 * namespace or declarations), a missing file, an htsl that maps to no
 * known importable, or a referenced item name the project doesn't declare
 * (the whole-project item check owns that diagnostic; direct .snbt refs
 * also bail since resolving them needs the project gcx).
 */
export function trySpliceSnapshot(
    snapshot: Snapshot,
    changed: readonly FingerprintChange[]
): Snapshot | null {
    if (changed.length === 0) return null;
    for (const change of changed) {
        if (change.mtime === 0 || !isHtslPath(change.path)) return null;
    }

    const itemNames = new Set<string>();
    for (const imp of snapshot.importables) {
        if (imp.type === "ITEM") itemNames.add(imp.name);
    }

    for (const change of changed) {
        const targets = spliceTargetsFor(snapshot, change.path);
        if (targets.length === 0) return null;

        let parsed: ParseResult<Action[]>;
        try {
            parsed = parseActionsResult(
                new SourceMap(new FileSystemFileLoader()),
                change.path
            );
        } catch (_e) {
            return null;
        }

        for (const name of referencedItemNamesInActions(parsed.value)) {
            if (itemReferences.isDirectSnbtItemReference(name)) return null;
            if (!itemNames.has(name)) return null;
        }

        // Drop stored diagnostics touching the changed file: their offsets
        // were computed against its old content. The fresh single-file
        // parse below re-derives that file's diagnostics.
        snapshot.diagnostics = snapshot.diagnostics.filter(
            (d) => !d.spans.some((s) => s.path === change.path)
        );
        for (const diag of parsed.diagnostics) {
            snapshot.diagnostics.push(
                serializeDiagnostic(parsed.gcx.sourceMap, diag)
            );
        }

        for (let t = 0; t < targets.length; t++) {
            const target = targets[t];
            const imp = snapshot.importables[target.index] as unknown as Record<
                string,
                unknown
            >;
            // Two slots sharing one htsl get distinct arrays, matching a
            // full parse (each reference parses the file separately).
            imp[target.prop] =
                t === 0
                    ? parsed.value
                    : (JSON.parse(JSON.stringify(parsed.value)) as Action[]);
            snapshot.hashes[target.index] = importableHash(
                snapshot.importables[target.index]
            );
        }
        snapshot.fingerprint[change.path] = change.mtime;
    }
    return snapshot;
}

/**
 * Reconstructs a `ParseResult<Importable[]>` from a cached snapshot.
 * Diagnostics come back with real spans (their files are loaded into the
 * fresh SourceMap), so `isFailed()`, rendering, and code-view placement
 * match the original parse. The AST `SpanTable` stays empty — action and
 * field span lookups return nothing. `gcx.sourceFiles` is rebuilt from
 * `sourcePaths` / `subListPaths` so watching and source-path resolution
 * work unchanged.
 */
export function restoreParseFromSnapshot(
    snapshot: Snapshot
): ParseResult<Importable[]> {
    const sm = new SourceMap(new FileSystemFileLoader());
    const gcx = new GlobalCtxt(sm, snapshot.importJsonPath);
    gcx.houseUuid = snapshot.houseUuid;
    for (const stored of snapshot.diagnostics) {
        gcx.addDiagnostic(restoreDiagnostic(sm, stored));
    }
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
    gcx.fileTree = deserializeFileTree(snapshot.fileTree, snapshot.importables);
    return {
        value: snapshot.importables,
        spans: new SpanTable(),
        diagnostics: gcx.diagnostics,
        gcx,
    };
}
