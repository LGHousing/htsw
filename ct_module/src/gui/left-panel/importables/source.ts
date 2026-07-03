/// <reference types="../../../../CTAutocomplete" />

import { Result, ResultImport, bumpTreeRevision } from "./rowModel";
import { toForwardSlashes } from "../../lib/pathDisplay";
import { isParsePending, requestParse } from "../../parsing/parses";

export type SourceDir = {
    kind: "dir";
    label: string;
    fullPath: string;
};
export type SourceFile = {
    kind: "file";
    label: string;
    fullPath: string;
};
export type Source = SourceDir | SourceFile;

const sources: Source[] = [];

// Structural views of the java.nio objects this walker touches — the runtime
// values are real Java classes; these list only the members we call.
type JavaPath = {
    toAbsolutePath(): JavaPath;
    normalize(): JavaPath;
    toString(): string;
    getFileName(): JavaPath | null;
    getParent(): JavaPath | null;
    relativize(other: JavaPath): JavaPath;
};
type JavaDirectoryStream = {
    iterator(): { hasNext(): boolean; next(): JavaPath };
    close(): void;
};
type JavaFilesStatics = {
    isDirectory(p: JavaPath): boolean;
    isRegularFile(p: JavaPath): boolean;
    newDirectoryStream(dir: JavaPath): JavaDirectoryStream;
    exists(p: JavaPath): boolean;
};
type JavaPathsStatics = { get(path: string): JavaPath };
type JavaStringQueue = { add(value: string): void; poll(): string | null };

// Lazy: top-level `Java.type(...)` is known to hang CT 1.8.9 at module
// load (see the comment block in `gui/lib/render.ts` above
// `getIconImage`). Defer the lookup + queue construction until the
// first source is actually queued.
let pendingPaths: JavaStringQueue | null = null;
function getPendingPaths(): JavaStringQueue {
    if (pendingPaths === null) {
        const ConcurrentLinkedQueue = Java.type("java.util.concurrent.ConcurrentLinkedQueue");
        pendingPaths = new ConcurrentLinkedQueue() as JavaStringQueue;
    }
    return pendingPaths;
}

function pathOf(absolute: string): JavaPath {
    const Paths: JavaPathsStatics = Java.type("java.nio.file.Paths");
    return Paths.get(String(absolute)).toAbsolutePath().normalize();
}

function fileNameOf(p: JavaPath): string {
    const fn = p.getFileName();
    if (fn === null) return String(p.toString());
    return String(fn.toString());
}

function alreadyHas(fullPath: string): boolean {
    for (let i = 0; i < sources.length; i++) {
        if (sources[i].fullPath === fullPath) return true;
    }
    return false;
}

function addSourceFromAbsolute(absolute: string): void {
    const Files: JavaFilesStatics = Java.type("java.nio.file.Files");
    let p: JavaPath;
    try {
        p = pathOf(absolute);
    } catch (_e) {
        return;
    }
    const fullPath = toForwardSlashes(String(p.toString()));
    if (alreadyHas(fullPath)) return;
    let isDir = false;
    let isFile = false;
    try {
        isDir = Files.isDirectory(p);
        isFile = !isDir && Files.isRegularFile(p);
    } catch (_e) {
        return;
    }
    if (isDir) {
        sources.push({ kind: "dir", label: fileNameOf(p), fullPath });
        bumpTreeRevision();
    } else if (isFile) {
        sources.push({ kind: "file", label: fileNameOf(p), fullPath });
        bumpTreeRevision();
    }
}

function drainPending(): void {
    if (pendingPaths === null) return; // never queued anything yet
    while (true) {
        const next = pendingPaths.poll();
        if (next === null) break;
        addSourceFromAbsolute(String(next));
    }
}

export function queueSourcePath(absolute: string): void {
    getPendingPaths().add(String(absolute));
}

export function getSources(): Source[] {
    drainPending();
    return sources;
}

export function removeSource(fullPath: string): void {
    for (let i = 0; i < sources.length; i++) {
        if (sources[i].fullPath === fullPath) {
            sources.splice(i, 1);
            enumerationCache.delete(fullPath);
            bumpTreeRevision();
            return;
        }
    }
}

function relativePath(root: JavaPath, p: JavaPath): string {
    const rel = root.relativize(p);
    return toForwardSlashes(String(rel.toString()));
}

function isRegularFileSafe(p: JavaPath): boolean {
    const Files: JavaFilesStatics = Java.type("java.nio.file.Files");
    try {
        return Files.isRegularFile(p);
    } catch (_e) {
        return false;
    }
}

function visitFile(p: JavaPath, root: JavaPath, out: Result[]): void {
    let fileName: JavaPath | null;
    try {
        fileName = p.getFileName();
    } catch (_e) {
        return;
    }
    if (fileName === null) return;
    let fname: string;
    let path: string;
    let fullPath: string;
    try {
        fname = String(fileName.toString()).toLowerCase();
        path = relativePath(root, p);
        fullPath = toForwardSlashes(String(p.toString()));
    } catch (_e) {
        return;
    }
    // Treat any *.json as an import.json entry — matches the file browser's
    // `isImportJsonEntry`. Without this, a user-renamed `x.import.json` or
    // `foo.json` gets silently dropped from the tree even though Browse
    // happily loads it.
    const isImportJson =
        fname === "import.json" ||
        (fname.length >= 5 && fname.lastIndexOf(".json") === fname.length - 5);
    if (isImportJson) {
        const cached = requestParse(fullPath);
        const r: ResultImport = {
            type: "import",
            path,
            fullPath,
            importables: cached?.parsed?.value ?? [],
            parsePending: cached === null || isParsePending(fullPath),
            parse: cached?.parsed ?? null,
            parseError: cached?.error ?? undefined,
        };
        out.push(r);
    } else if (fname.length >= 5 && fname.lastIndexOf(".htsl") === fname.length - 5) {
        out.push({ type: "script", path, fullPath });
    } else if (fname.length >= 5 && fname.lastIndexOf(".snbt") === fname.length - 5) {
        out.push({ type: "item", path, fullPath });
    }
}

function isDirectorySafe(p: JavaPath): boolean {
    const Files: JavaFilesStatics = Java.type("java.nio.file.Files");
    try {
        return Files.isDirectory(p);
    } catch (_e) {
        return false;
    }
}

// Walk `dir`. When `depth > 0`, descend into immediate child directories
// once (so depth=1 gives the folder root + one nest deep, no further).
// Bounded recursion keeps the Importables list usable while letting the user
// drop a parent folder and still find the import.json one level in.
function walkDir(dir: JavaPath, root: JavaPath, out: Result[], depth: number = 1): void {
    const Files: JavaFilesStatics = Java.type("java.nio.file.Files");
    let stream: JavaDirectoryStream;
    try {
        stream = Files.newDirectoryStream(dir);
    } catch (_e) {
        return;
    }
    try {
        const it = stream.iterator();
        while (true) {
            let entry: JavaPath;
            try {
                if (!it.hasNext()) break;
                entry = it.next();
            } catch (_e) {
                break;
            }
            if (isRegularFileSafe(entry)) {
                try {
                    visitFile(entry, root, out);
                } catch (_e) {
                    /* skip */
                }
            } else if (depth > 0 && isDirectorySafe(entry)) {
                walkDir(entry, root, out, depth - 1);
            }
        }
    } finally {
        try {
            stream.close();
        } catch (_e) {
            /* ignore */
        }
    }
}

// Per-source TTL cache. The full directory walk is expensive (recursive readdir + stat per
// entry), and `buildTreeRows()` runs every frame as a Scroll children extractable, so without
// a cache we'd hit the filesystem hundreds of times per second. 1s TTL means new files appear
// with at most ~1s lag; that's acceptable for this UI.
const ENUMERATION_TTL_MS = 1000;
const enumerationCache = new Map<string, { at: number; results: Result[] }>();

function enumerateForSourceUncached(s: Source): Result[] {
    const Paths: JavaPathsStatics = Java.type("java.nio.file.Paths");
    const Files: JavaFilesStatics = Java.type("java.nio.file.Files");
    const out: Result[] = [];
    let p: JavaPath;
    try {
        p = Paths.get(String(s.fullPath));
    } catch (_e) {
        return out;
    }
    let exists = false;
    try {
        exists = Files.exists(p);
    } catch (_e) {
        return out;
    }
    if (!exists) return out;
    if (s.kind === "dir") {
        walkDir(p, p, out);
    } else {
        const parent = p.getParent();
        const root = parent === null ? p : parent;
        try {
            visitFile(p, root, out);
        } catch (_e) {
            /* skip */
        }
    }
    return out;
}

export function enumerateForSource(s: Source): Result[] {
    const now = Date.now();
    const cached = enumerationCache.get(s.fullPath);
    let results: Result[];
    if (cached !== undefined && now - cached.at < ENUMERATION_TTL_MS) {
        results = cached.results;
    } else {
        results = enumerateForSourceUncached(s);
        enumerationCache.set(s.fullPath, { at: now, results });
    }
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.type !== "import") continue;
        // Cold entries return null here and warm up off-frame; only adopt a
        // real parse so we never blank out rows we've already shown.
        const fresh = requestParse(r.fullPath);
        r.parsePending = fresh === null || isParsePending(r.fullPath);
        if (fresh !== null && fresh.parsed !== r.parse) {
            r.importables = fresh.parsed?.value ?? [];
            r.parse = fresh.parsed;
            if (fresh.error !== null) r.parseError = fresh.error;
            else delete r.parseError;
        }
    }
    return results;
}
