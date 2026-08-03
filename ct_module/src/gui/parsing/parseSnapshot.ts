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
import { getMtimeMs, runtimeString, type RuntimeString } from "../lib/java";
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
// 19: import.json entry-level diagnostics no longer discard the rest of an
// included file's parsed importables.
const SNAPSHOT_VERSION = 19;

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
    // the Projects include tree as one flat list.
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

function isSnapshotDiagnostic(value: unknown): value is SnapshotDiagnostic {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
    const diagnostic = value as Record<string, unknown>;
    if (
        diagnostic.level !== "bug" &&
        diagnostic.level !== "error" &&
        diagnostic.level !== "warning" &&
        diagnostic.level !== "note" &&
        diagnostic.level !== "help"
    ) {
        return false;
    }
    if (typeof diagnostic.message !== "string") return false;
    if (!Array.isArray(diagnostic.spans) || !Array.isArray(diagnostic.notes)) return false;
    if (diagnostic.notes.some((note) => typeof note !== "string")) return false;
    for (const spanValue of diagnostic.spans) {
        if (
            spanValue === null ||
            typeof spanValue !== "object" ||
            Array.isArray(spanValue)
        ) {
            return false;
        }
        const span = spanValue as Record<string, unknown>;
        if (span.kind !== "primary" && span.kind !== "secondary") return false;
        if (typeof span.path !== "string") return false;
        if (typeof span.start !== "number" || typeof span.end !== "number") return false;
        if (span.label !== undefined && typeof span.label !== "string") return false;
    }
    return true;
}

export function loadSnapshot(importJsonPath: string): Snapshot | null {
    const p = snapshotFileFor(importJsonPath);
    if (!FileLib.exists(p)) return null;
    try {
        const stored = FileLib.read(p) as RuntimeString | null | undefined;
        const raw = runtimeString(stored);
        if (raw.length === 0) return null;
        const parsed: unknown = JSON.parse(raw);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        const snapshot = parsed as { [key: string]: unknown };
        if (snapshot.version !== SNAPSHOT_VERSION) return null;
        if (snapshot.importJsonPath !== importJsonPath) return null;
        if (!Array.isArray(snapshot.importables)) return null;
        if (!Array.isArray(snapshot.hashes)) return null;
        if (snapshot.hashes.length !== snapshot.importables.length) return null;
        if (snapshot.houseUuid !== null && typeof snapshot.houseUuid !== "string")
            return null;
        if (
            snapshot.fingerprint === null ||
            typeof snapshot.fingerprint !== "object" ||
            Array.isArray(snapshot.fingerprint)
        )
            return null;
        if (snapshot.fileTree !== null && typeof snapshot.fileTree !== "object") return null;
        if (!Array.isArray(snapshot.diagnostics)) return null;
        for (const d of snapshot.diagnostics) {
            if (!isSnapshotDiagnostic(d)) return null;
        }
        return snapshot as Snapshot;
    } catch (_e) {
        return null;
    }
}

export type FingerprintChange = { path: string; mtime: number };

export type SnapshotSaveMetrics = {
    hashMs: number;
    buildMs: number;
    serializeMs: number;
    writeMs: number;
    bytes: number | null;
};

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
function serializeDiagnostic(sm: SourceMap, diag: Diagnostic): SnapshotDiagnostic {
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
    let diag: Diagnostic;
    switch (stored.level) {
        case "bug":
            diag = Diagnostic.bug(stored.message);
            break;
        case "error":
            diag = Diagnostic.error(stored.message);
            break;
        case "warning":
            diag = Diagnostic.warning(stored.message);
            break;
        case "help":
            diag = Diagnostic.help(stored.message);
            break;
        case "note":
            diag = Diagnostic.note(stored.message);
            break;
    }
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
    watchedMtimes: { [path: string]: number },
    precomputedHashes?: readonly string[]
): SnapshotSaveMetrics {
    const hashStartedAt = Date.now();
    const hashes =
        precomputedHashes === undefined
            ? result.value.map(memoizedImportableHash)
            : precomputedHashes.slice();
    const hashMs = Date.now() - hashStartedAt;
    const buildStartedAt = Date.now();
    const fingerprint: { [path: string]: number } = {};
    for (const k in watchedMtimes) fingerprint[k] = watchedMtimes[k];
    const snapshot: Snapshot = {
        version: SNAPSHOT_VERSION,
        importJsonPath,
        fingerprint,
        importables: result.value,
        hashes,
        houseUuid: result.importJson.houseUuid,
        fileTree: serializeFileTree(result.importJson.fileTree, result.value),
        diagnostics: result.diagnostics.map((d) =>
            serializeDiagnostic(result.gcx.sourceMap, d)
        ),
    };
    const buildMs = Date.now() - buildStartedAt;
    const serializeStartedAt = Date.now();
    let serialized: string;
    try {
        serialized = JSON.stringify(snapshot);
    } catch (_e) {
        return {
            hashMs,
            buildMs,
            serializeMs: Date.now() - serializeStartedAt,
            writeMs: 0,
            bytes: null,
        };
    }
    const bytes = utf8ByteLength(serialized);
    const serializeMs = Date.now() - serializeStartedAt;
    const writeStartedAt = Date.now();
    writeSnapshotFile(snapshot.importJsonPath, serialized);
    const writeMs = Date.now() - writeStartedAt;
    return {
        hashMs,
        buildMs,
        serializeMs,
        writeMs,
        bytes,
    };
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
            const index = node.importables[i];
            if (index >= 0 && index < flat.length) imps.push(flat[index]);
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

function utf8ByteLength(value: string): number {
    let bytes = 0;
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code <= 0x7f) {
            bytes++;
        } else if (code <= 0x7ff) {
            bytes += 2;
        } else if (
            code >= 0xd800 &&
            code <= 0xdbff &&
            i + 1 < value.length &&
            value.charCodeAt(i + 1) >= 0xdc00 &&
            value.charCodeAt(i + 1) <= 0xdfff
        ) {
            bytes += 4;
            i++;
        } else {
            bytes += 3;
        }
    }
    return bytes;
}

function writeSnapshotFile(importJsonPath: string, serialized: string): void {
    try {
        const out = snapshotFileFor(importJsonPath);
        ensureParentDirs(out);
        FileLib.write(out, serialized, true);
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
export function restoreParseFromSnapshot(snapshot: Snapshot): ImportablesParseResult {
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
