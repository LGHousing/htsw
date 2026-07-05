/// <reference types="../../../CTAutocomplete" />

/**
 * On-disk cache of `parseImportablesResult` output, keyed by the
 * import.json file path. Lets the GUI populate instantly on `/ct reload`
 * for projects whose source files haven't changed since the last full
 * parse — the htsw parse for a 300+ file project takes ~1s and blocks
 * the main thread; loading a snapshot is a single JSON read.
 *
 * The snapshot stores `value` (the parsed `Importable[]`), importable
 * source paths, child list source paths, and the parse's diagnostics with
 * their spans resolved to file-relative offsets. Restoring rebuilds the
 * diagnostics with REAL spans (loading just the diagnostic-bearing files
 * into the new SourceMap), so `isFailed()`, squiggles, and hover survive
 * the round trip. What does NOT survive is the AST `SpanTable` — span
 * lookups for actions/fields return nothing on a restored parse.
 * `CachedParse.fromSnapshot` says which kind you're holding.
 *
 * Validity is checked by mtime fingerprint: every file the previous
 * parse referenced (import.json + every linked .htsl) must match its
 * recorded mtime, or we fall through to a full parse. Missing included import.json files are stored in the
 * fingerprint with mtime 0, so creating them invalidates the snapshot.
 *
 * Parser-output shape or persisted hash changes must bump the snapshot
 * `version` below. Tying snapshots to the deployed GUI bundle mtime made
 * every UI-only deploy force a full reparse of every project on first open.
 */

import {
    Diagnostic,
    GlobalCtxt,
    SourceMap,
    Span,
    SpanTable,
    type ImportJsonFileNode,
    ImportJsonParseMetadata,
    type ImportablesParseResult,
} from "htsw";
import type { Importable } from "htsw/types";

import { FileSystemFileLoader } from "../../utils/fileLoaders";
import { ensureParentDirs } from "../../utils/filesystem";
import { getMtimeMs } from "../lib/java";
import { memoizedImportableHash, seedImportableHash } from "../../importCache/status";

const SNAPSHOT_DIR = "./htsw/.parse-snapshots";
// 15: v13/v14 snapshots could persist a mis-homed include tree (v13:
// rehomeFileTree not yet run; v14: the parse entry was the relative
// `./htsw/...` form, whose root node absolute-vs-relative mismatch made
// the rehome containment check never match). A fingerprint match would
// serve the bad tree forever.
// 16: fileTree gained `missing` leaf nodes for nonexistent includes.
// 17: importables carry `sourcePath` themselves; the parallel `sourcePaths`
// array is gone.
// 18: child list and menu-slot paths are fields on the importables too
// (`onEnterActionsPath`, slot `nbtPath`/`actionsPath`, …); `childListPaths`
// is gone.
const SNAPSHOT_VERSION = 18;

// importJson.fileTree with each importable replaced by its index into the
// snapshot's flat `importables` array — serializing the objects in place
// would store every importable twice.
type SerializedFileNode = {
    path: string;
    importables: number[];
    includes: SerializedFileNode[];
    reference?: boolean;
    missing?: boolean;
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
    version: typeof SNAPSHOT_VERSION;
    importJsonPath: string;
    fingerprint: { [path: string]: number };
    importables: Importable[];
    // importableHash per importable, index-aligned with `importables`. Persisted
    // so a reload reuses them instead of re-hashing every action tree.
    hashes: string[];
    // importJson.houseUuid of the snapshotted parse — the entry file's "houseUuid"
    // binding. Must round-trip, or a snapshot-served session sees every
    // bound file as unbound.
    houseUuid: string | null;
    // importJson.fileTree. Must round-trip, or a snapshot-served session renders
    // the Importables include tree as one flat list.
    fileTree: SerializedFileNode | null;
    // The parse's diagnostics, pre-rendered.
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

export function loadSnapshot(importJsonPath: string): Snapshot | null {
    const p = snapshotFileFor(importJsonPath);
    if (!FileLib.exists(p)) return null;
    try {
        const raw = String(FileLib.read(p) ?? "");
        if (raw.length === 0) return null;
        const parsed = JSON.parse(raw) as Snapshot;
        if (parsed.version !== SNAPSHOT_VERSION) return null;
        if (parsed.importJsonPath !== importJsonPath) return null;
        if (!Array.isArray(parsed.importables)) return null;
        if (!Array.isArray(parsed.hashes)) return null;
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
    result: ImportablesParseResult,
    watchedMtimes: { [path: string]: number }
): void {
    const fingerprint: { [path: string]: number } = {};
    for (const k in watchedMtimes) fingerprint[k] = watchedMtimes[k];
    const snapshot: Snapshot = {
        version: SNAPSHOT_VERSION,
        importJsonPath,
        fingerprint,
        importables: result.value,
        hashes: result.value.map(memoizedImportableHash),
        houseUuid: result.importJson.houseUuid,
        fileTree: serializeFileTree(result.importJson.fileTree, result.value),
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
        const out: SerializedFileNode = {
            path: node.path,
            importables: indices,
            includes: node.includes.map(visit),
        };
        if (node.reference === true) out.reference = true;
        if (node.missing === true) out.missing = true;
        return out;
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
        const out: ImportJsonFileNode = {
            path: node.path,
            importables: imps,
            includes: node.includes.map(visit),
        };
        if (node.reference === true) out.reference = true;
        if (node.missing === true) out.missing = true;
        return out;
    };
    return visit(tree);
}

function writeSnapshotFile(snapshot: Snapshot): void {
    try {
        const out = snapshotFileFor(snapshot.importJsonPath);
        ensureParentDirs(out);
        FileLib.write(out, JSON.stringify(snapshot), true);
    } catch (_e) {
        // Cache is best-effort; failures don't disturb the parse path.
    }
}

/**
 * Reconstructs a `ImportablesParseResult` from a cached snapshot.
 * Diagnostics come back with real spans (their files are loaded into the
 * fresh SourceMap), so `isFailed()`, rendering, and code-view placement
 * match the original parse. The AST `SpanTable` stays empty — action and
 * field span lookups return nothing. Importables carry all their path
 * attribution (`sourcePath`, per-list `…ActionsPath`, slot paths) through
 * serialization, so source-path resolution works unchanged.
 */
export function restoreParseFromSnapshot(
    snapshot: Snapshot
): ImportablesParseResult {
    const sm = new SourceMap(new FileSystemFileLoader());
    const gcx = new GlobalCtxt(sm, snapshot.importJsonPath);
    const importJson = new ImportJsonParseMetadata();
    importJson.houseUuid = snapshot.houseUuid;
    for (const stored of snapshot.diagnostics) {
        gcx.addDiagnostic(restoreDiagnostic(sm, stored));
    }
    for (let i = 0; i < snapshot.importables.length; i++) {
        seedImportableHash(snapshot.importables[i], snapshot.hashes[i]);
    }
    importJson.fileTree = deserializeFileTree(snapshot.fileTree, snapshot.importables);
    return {
        value: snapshot.importables,
        spans: new SpanTable(),
        diagnostics: gcx.diagnostics,
        gcx,
        importJson,
    };
}
