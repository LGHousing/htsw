/// <reference types="../../../../CTAutocomplete" />

import { Result, ResultImport, bumpTreeRevision } from "./rowModel";
import { normalizePathSeparators } from "htsw-editor-common/project";
import {
    canonicalPath,
    disposeParseCachesUnder,
    getParseAt,
    isParsePending,
    requestParse,
    type CachedParse,
} from "../../parsing/parses";
import { javaType, runtimeString, type RuntimeString } from "../../lib/java";
import { recordPhase } from "../../lib/framePerf";
import { getImportJsonPath, setImportJsonPath } from "../../state";
import { disposeLineModelCachesUnder } from "../../code-view/lineModel";
import { BoundedLruMap } from "../../lib/boundedLruMap";

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
type JavaStringQueue = { add(value: string): void; poll(): RuntimeString | null | undefined };

// Lazy: top-level `Java.type(...)` is known to hang CT 1.8.9 at module
// load (see the comment block in `gui/lib/render.ts` above
// `getIconImage`). Defer the lookup + queue construction until the
// first source is actually queued.
let pendingPaths: JavaStringQueue | null = null;
function getPendingPaths(): JavaStringQueue {
    if (pendingPaths === null) {
        const ConcurrentLinkedQueue = javaType(
            "java.util.concurrent.ConcurrentLinkedQueue"
        );
        pendingPaths = new ConcurrentLinkedQueue();
    }
    return pendingPaths;
}

function pathOf(absolute: string): HtswJavaPath {
    const Paths = javaType("java.nio.file.Paths");
    return Paths.get(absolute).toAbsolutePath().normalize();
}

function fileNameOf(p: HtswJavaPath): string {
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
    const Files = javaType("java.nio.file.Files");
    // Identity via canonicalPath, like every other path comparison — dedup
    // by any other spelling lets the same project open twice.
    const fullPath = canonicalPath(absolute);
    let p: HtswJavaPath;
    try {
        p = pathOf(fullPath);
    } catch (_e) {
        return;
    }
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
    for (;;) {
        const next = pendingPaths.poll();
        if (next === null || next === undefined) break;
        addSourceFromAbsolute(runtimeString(next));
    }
}

export function queueSourcePath(absolute: string): void {
    getPendingPaths().add(absolute);
}

export function getSources(): Source[] {
    drainPending();
    return sources;
}

export function removeSource(fullPath: string): void {
    for (let i = 0; i < sources.length; i++) {
        if (sources[i].fullPath === fullPath) {
            const removed = sources[i];
            sources.splice(i, 1);
            enumerationCache.delete(fullPath);
            disposeParseCachesUnder(fullPath);
            disposeLineModelCachesUnder(fullPath);
            const activePath = getImportJsonPath();
            if (
                activePath !== "" &&
                sourceContainsPath(removed, activePath) &&
                !sources.some((source) => sourceContainsPath(source, activePath))
            ) {
                setImportJsonPath("");
            }
            bumpTreeRevision();
            return;
        }
    }
}

function sourceContainsPath(source: Source, path: string): boolean {
    const sourcePath = canonicalPath(source.fullPath);
    const targetPath = canonicalPath(path);
    if (source.kind === "file") return sourcePath === targetPath;
    const prefix = sourcePath.endsWith("/") ? sourcePath : `${sourcePath}/`;
    return targetPath === sourcePath || targetPath.startsWith(prefix);
}

function relativePath(root: HtswJavaPath, p: HtswJavaPath): string {
    const rel = root.relativize(p);
    return normalizePathSeparators(String(rel.toString()));
}

function isRegularFileSafe(p: HtswJavaPath): boolean {
    const Files = javaType("java.nio.file.Files");
    try {
        return Files.isRegularFile(p);
    } catch (_e) {
        return false;
    }
}

function visitFile(p: HtswJavaPath, root: HtswJavaPath, out: Result[]): void {
    let fileName: HtswJavaPath | null;
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
        fullPath = normalizePathSeparators(String(p.toString()));
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
        const cached = getParseAt(fullPath);
        const r: ResultImport = {
            type: "import",
            path,
            fullPath,
            importables: cached?.parsed?.value ?? [],
            parsePending: cached === null && isParsePending(fullPath),
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

function isDirectorySafe(p: HtswJavaPath): boolean {
    const Files = javaType("java.nio.file.Files");
    try {
        return Files.isDirectory(p);
    } catch (_e) {
        return false;
    }
}

// Walk `dir`. When `depth > 0`, descend into immediate child directories
// once (so depth=1 gives the folder root + one nest deep, no further).
// Bounded recursion keeps the Projects list usable while letting the user
// drop a parent folder and still find the import.json one level in.
function walkDir(
    dir: HtswJavaPath,
    root: HtswJavaPath,
    out: Result[],
    depth: number = 1
): void {
    const Files = javaType("java.nio.file.Files");
    let stream: HtswJavaDirectoryStream;
    try {
        stream = Files.newDirectoryStream(dir);
    } catch (_e) {
        return;
    }
    try {
        const it = stream.iterator();
        for (;;) {
            let entry: HtswJavaPath;
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

// File discovery is retained for the lifetime of an open source. Project
// parsing owns freshness for files already in the project; repeating this
// recursive directory walk from a GUI rebuild made an unrelated caret click
// synchronously stat the whole source.
const enumerationCache = new BoundedLruMap<string, Result[]>(32);

export function enumerationCacheSize(): number {
    return enumerationCache.size;
}

function enumerateForSourceUncached(s: Source): Result[] {
    const startedAt = Date.now();
    const Paths = javaType("java.nio.file.Paths");
    const Files = javaType("java.nio.file.Files");
    const out: Result[] = [];
    try {
        let p: HtswJavaPath;
        try {
            p = Paths.get(s.fullPath);
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
    } finally {
        recordPhase("source-enumeration", Date.now() - startedAt);
    }
}

function adoptParse(r: ResultImport, cached: CachedParse | null): void {
    r.parsePending = cached === null && isParsePending(r.fullPath);
    if (cached === null) return;
    if (cached.parsed !== r.parse) {
        r.importables = cached.parsed?.value ?? [];
        r.parse = cached.parsed;
    }
    if (cached.error !== null) r.parseError = cached.error;
    else delete r.parseError;
}

export function requestResultParse(r: ResultImport): void {
    adoptParse(r, requestParse(r.fullPath));
}

export function enumerateForSource(s: Source): Result[] {
    const cached = enumerationCache.get(s.fullPath);
    let results: Result[];
    if (cached !== undefined) {
        results = cached;
    } else {
        results = enumerateForSourceUncached(s);
        enumerationCache.set(s.fullPath, results);
    }
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (r.type !== "import") continue;
        adoptParse(r, getParseAt(r.fullPath));
    }
    return results;
}
