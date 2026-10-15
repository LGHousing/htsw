/**
 * A parsed project that can be prepared once and restored in another
 * directory, whole or as just what one import needs.
 *
 * `publishProject` turns a parse into a manifest plus one JSON body per
 * importable. Every path is stored relative to the project root, so another
 * copy of the same sources restores it under its own root. The manifest key
 * covers the parser version and the digest of every referenced source, which
 * the publisher supplies (HTSW does not hash file bytes itself).
 *
 * A selected restore keeps the chosen importables plus every ITEM, TEAM and
 * GROUP: those are all an import reads from the rest of the project (item
 * names, aliases and fingerprints, auto-added teams/groups/items). Functions,
 * menus and regions are only referenced by name, so their bodies stay out.
 * A selected parse never arms prune and is never saved as the project's
 * snapshot, because it declares less than the project does.
 */

import {
    GlobalCtxt,
    ImportJsonParseMetadata,
    SourceMap,
    SpanTable,
    allReferencedPaths,
    importableFilePaths,
    type ImportJsonFileNode,
    type ImportablesParseResult,
} from "htsw";
import type { Importable } from "htsw/types";

import { FileSystemFileLoader } from "../utils/fileLoaders";
import { hashHex } from "../utils/hash";
import { stableStringify } from "../utils/helpers";
import { memoizedImportableHash, seedImportableHash } from "../importCache/status";
import { importableIdentity, importableKey } from "../importables/identity";
import { getMtimeMs } from "../gui/lib/java";
import { canonicalPath, installParse, type CachedParse } from "../gui/parsing/parses";
import {
    SNAPSHOT_VERSION,
    markPartialParse,
    restoreDiagnostic,
    serializeDiagnostic,
    type SnapshotDiagnostic,
} from "../gui/parsing/parseSnapshot";

const FORMAT = "htsw-project-publication";
const VERSION = 1;

// The parse-side path fields, as `importableHash` skips them.
const PATH_KEYS = [
    "sourcePath",
    "actionsPath",
    "nbtPath",
    "onEnterActionsPath",
    "onExitActionsPath",
    "leftClickActionsPath",
    "rightClickActionsPath",
];

const SHARED_TYPES: ReadonlySet<Importable["type"]> = new Set(["ITEM", "TEAM", "GROUP"]);

type PublishedFileNode = {
    path: string;
    importables: number[];
    includes: PublishedFileNode[];
    reference?: boolean;
    missing?: boolean;
};

export type ProjectPublication = {
    // Read back from disk, so checked rather than trusted.
    format: string;
    version: number;
    parserVersion: number;
    /** Same parser version and source digests, same key. */
    key: string;
    /** The entry import.json, relative to the project root. */
    importJson: string;
    /** Digest of every referenced file, relative to the root; null = missing. */
    sources: { [path: string]: string | null };
    houseUuid: string | null;
    dangerouslyDeleteEverythingNotInThisFile: boolean;
    /** Index-aligned with the bodies. */
    importables: Array<{ type: Importable["type"]; identity: string; hash: string }>;
    fileTree: PublishedFileNode | null;
    /** `owners` are the importables whose files hold the primary span. */
    diagnostics: Array<SnapshotDiagnostic & { owners: number[] }>;
};

type ImportableSelection = { type: Importable["type"]; identity: string };

function relativePath(root: string, path: string): string {
    for (const separator of ["/", "\\"]) {
        const prefix = root.endsWith(separator) ? root : root + separator;
        if (path.startsWith(prefix)) {
            return path.slice(prefix.length).split("\\").join("/");
        }
    }
    throw new Error(`Project file ${path} is outside the project root ${root}`);
}

function rootedPath(root: string, path: string): string {
    const separator = root.indexOf("/") === -1 && root.indexOf("\\") !== -1 ? "\\" : "/";
    const base = root.endsWith(separator) ? root.slice(0, -1) : root;
    return base + separator + path.split("/").join(separator);
}

function withPaths<T extends object>(subject: T, map: (path: string) => string): T {
    const out = { ...subject } as Record<string, unknown>;
    for (const key of PATH_KEYS) {
        const value = out[key];
        if (typeof value === "string") out[key] = map(value);
    }
    return out as T;
}

function importableWithPaths(importable: Importable, map: (path: string) => string): Importable {
    const out = withPaths(importable, map);
    if (out.type === "MENU") out.slots = out.slots.map((slot) => withPaths(slot, map));
    return out;
}

function diagnosticWithPaths<T extends SnapshotDiagnostic>(
    diagnostic: T,
    map: (path: string) => string
): T {
    return {
        ...diagnostic,
        spans: diagnostic.spans.map((span) => ({ ...span, path: map(span.path) })),
    };
}

export function publishProject(
    parsed: ImportablesParseResult,
    root: string,
    sources: { readonly [path: string]: string | null }
): { manifest: ProjectPublication; bodies: string[] } {
    const relative = (path: string) => relativePath(root, path);
    const importJsonPath = parsed.gcx.path;
    for (const path of allReferencedPaths(importJsonPath, parsed)) {
        if (!Object.prototype.hasOwnProperty.call(sources, path)) {
            throw new Error(`No source digest for ${path}`);
        }
    }
    const publishedSources: { [path: string]: string | null } = {};
    for (const path of Object.keys(sources).sort()) {
        publishedSources[relative(path)] = sources[path];
    }
    const importJson = relative(importJsonPath);

    const indexOf = new Map<Importable, number>();
    const ownersByFile = new Map<string, number[]>();
    const importables: ProjectPublication["importables"] = [];
    const bodies: string[] = [];
    parsed.value.forEach((importable, index) => {
        indexOf.set(importable, index);
        for (const file of new Set(importableFilePaths(importable))) {
            const owners = ownersByFile.get(file);
            if (owners === undefined) ownersByFile.set(file, [index]);
            else owners.push(index);
        }
        importables.push({
            type: importable.type,
            identity: importableIdentity(importable),
            hash: memoizedImportableHash(importable),
        });
        bodies.push(JSON.stringify(importableWithPaths(importable, relative)));
    });

    const publishTree = (node: ImportJsonFileNode): PublishedFileNode => {
        const out: PublishedFileNode = {
            path: relative(node.path),
            importables: [],
            includes: node.includes.map(publishTree),
        };
        for (const importable of node.importables) {
            const index = indexOf.get(importable);
            if (index !== undefined) out.importables.push(index);
        }
        if (node.reference === true) out.reference = true;
        if (node.missing === true) out.missing = true;
        return out;
    };

    const diagnostics = parsed.diagnostics.map((diagnostic) => {
        const stored = serializeDiagnostic(parsed.gcx.sourceMap, diagnostic);
        const owners =
            stored.spans.length === 0
                ? []
                : (ownersByFile.get(
                      (stored.spans.find((span) => span.kind === "primary") ?? stored.spans[0]).path
                  ) ?? []);
        return { ...diagnosticWithPaths(stored, relative), owners: owners.slice() };
    });

    const manifest: ProjectPublication = {
        format: FORMAT,
        version: VERSION,
        parserVersion: SNAPSHOT_VERSION,
        key: hashHex(
            stableStringify({
                format: FORMAT,
                version: VERSION,
                parserVersion: SNAPSHOT_VERSION,
                importJson,
                sources: publishedSources,
            })
        ),
        importJson,
        sources: publishedSources,
        houseUuid: parsed.importJson.houseUuid,
        dangerouslyDeleteEverythingNotInThisFile:
            parsed.importJson.dangerouslyDeleteEverythingNotInThisFile,
        importables,
        fileTree:
            parsed.importJson.fileTree === null ? null : publishTree(parsed.importJson.fileTree),
        diagnostics,
    };
    return { manifest, bodies };
}

/**
 * Rebuild the parse under `root`, like a snapshot restore. With `selection`,
 * only the selected importables plus every ITEM, TEAM and GROUP are loaded.
 */
export function restoreProjectPublication(
    manifest: ProjectPublication,
    root: string,
    loadBody: (index: number) => string,
    selection?: readonly ImportableSelection[]
): ImportablesParseResult {
    if (
        manifest.format !== FORMAT ||
        manifest.version !== VERSION ||
        manifest.parserVersion !== SNAPSHOT_VERSION
    ) {
        throw new Error("The prepared project was published by a different HTSW version");
    }
    const rooted = (path: string) => rootedPath(root, path);
    const selected =
        selection === undefined
            ? null
            : new Set(selection.map((entry) => importableKey(entry.type, entry.identity)));

    const restoredIndex = new Map<number, Importable>();
    const value: Importable[] = [];
    manifest.importables.forEach((entry, index) => {
        if (
            selected !== null &&
            !SHARED_TYPES.has(entry.type) &&
            !selected.has(importableKey(entry.type, entry.identity))
        ) {
            return;
        }
        const importable = importableWithPaths(
            JSON.parse(loadBody(index)) as Importable,
            rooted
        );
        if (importable.type !== entry.type || importableIdentity(importable) !== entry.identity) {
            throw new Error(`Prepared project body ${index} is not ${entry.type} ${entry.identity}`);
        }
        seedImportableHash(importable, entry.hash);
        restoredIndex.set(index, importable);
        value.push(importable);
    });

    const sm = new SourceMap(new FileSystemFileLoader());
    const gcx = new GlobalCtxt(sm, rooted(manifest.importJson));
    // A diagnostic owned only by importables left out could never block this
    // import; restored without its owners it would read as unattributed.
    for (const stored of manifest.diagnostics) {
        if (stored.owners.length > 0 && !stored.owners.some((owner) => restoredIndex.has(owner))) {
            continue;
        }
        gcx.addDiagnostic(restoreDiagnostic(sm, diagnosticWithPaths(stored, rooted)));
    }

    const restoreTree = (node: PublishedFileNode): ImportJsonFileNode => {
        const out: ImportJsonFileNode = {
            path: rooted(node.path),
            importables: [],
            includes: node.includes.map(restoreTree),
        };
        for (const index of node.importables) {
            const importable = restoredIndex.get(index);
            if (importable !== undefined) out.importables.push(importable);
        }
        if (node.reference === true) out.reference = true;
        if (node.missing === true) out.missing = true;
        return out;
    };
    const importJson = new ImportJsonParseMetadata();
    importJson.houseUuid = manifest.houseUuid;
    importJson.dangerouslyDeleteEverythingNotInThisFile =
        selected === null && manifest.dangerouslyDeleteEverythingNotInThisFile;
    importJson.fileTree = manifest.fileTree === null ? null : restoreTree(manifest.fileTree);

    const parsed: ImportablesParseResult = {
        value,
        spans: new SpanTable(),
        diagnostics: gcx.diagnostics,
        gcx,
        importJson,
    };
    if (selected !== null) markPartialParse(parsed);
    return parsed;
}

/**
 * Restore under `root` and serve the result for its import.json, so commands
 * such as `/htsw queue add` and `/htsw queue run` use it. The caller must have
 * checked that the files under `root` match `manifest.sources`. Their current
 * mtimes become the freshness fingerprint, so any later edit falls back to a
 * normal full parse.
 */
export function installProjectPublication(
    manifest: ProjectPublication,
    root: string,
    loadBody: (index: number) => string,
    selection?: readonly ImportableSelection[]
): CachedParse {
    const canonicalRoot = canonicalPath(root);
    const parsed = restoreProjectPublication(manifest, canonicalRoot, loadBody, selection);
    const fingerprint: { [path: string]: number } = {};
    for (const path in manifest.sources) {
        const rooted = rootedPath(canonicalRoot, path);
        fingerprint[rooted] = getMtimeMs(rooted);
    }
    return installParse(parsed.gcx.path, parsed, fingerprint);
}
