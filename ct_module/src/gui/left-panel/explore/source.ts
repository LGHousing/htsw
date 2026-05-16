/// <reference types="../../../../CTAutocomplete" />

import { Result, ResultImport } from "./types";
import { parseImportJsonAt } from "../../state/parses";

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

// Lazy: top-level `Java.type(...)` is known to hang CT 1.8.9 at module
// load (see the comment block in `gui/lib/render.ts` above
// `getIconImage`). Defer the lookup + queue construction until the
// first source is actually queued.
let pendingPaths: any = null;
function getPendingPaths(): any {
    if (pendingPaths === null) {
        const ConcurrentLinkedQueue = Java.type("java.util.concurrent.ConcurrentLinkedQueue");
        pendingPaths = new ConcurrentLinkedQueue();
    }
    return pendingPaths;
}

function pathOf(absolute: string): any {
    const Paths = Java.type("java.nio.file.Paths");
    return Paths.get(String(absolute)).toAbsolutePath().normalize();
}

function fileNameOf(p: any): string {
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
    const Files = Java.type("java.nio.file.Files");
    let p: any;
    try {
        p = pathOf(absolute);
    } catch (_e) {
        return;
    }
    const fullPath = String(p.toString()).replace(/\\/g, "/");
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
    } else if (isFile) {
        sources.push({ kind: "file", label: fileNameOf(p), fullPath });
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
            return;
        }
    }
}

function relativePath(root: any, p: any): string {
    const rel = root.relativize(p);
    return String(rel.toString()).replace(/\\/g, "/");
}

function isRegularFileSafe(p: any): boolean {
    const Files = Java.type("java.nio.file.Files");
    try {
        return Files.isRegularFile(p);
    } catch (_e) {
        return false;
    }
}

function visitFile(p: any, root: any, out: Result[]): void {
    let fileName: any;
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
        fullPath = String(p.toString()).replace(/\\/g, "/");
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
        const cached = parseImportJsonAt(fullPath);
        const r: ResultImport = {
            type: "import",
            path,
            fullPath,
            importables: cached.parsed?.value ?? [],
            parse: cached.parsed,
            parseError: cached.error ?? undefined,
        };
        out.push(r);
    } else if (fname.length >= 5 && fname.lastIndexOf(".htsl") === fname.length - 5) {
        out.push({ type: "script", path, fullPath });
    } else if (fname.length >= 5 && fname.lastIndexOf(".snbt") === fname.length - 5) {
        out.push({ type: "item", path, fullPath });
    }
}

function isDirectorySafe(p: any): boolean {
    const Files = Java.type("java.nio.file.Files");
    try {
        return Files.isDirectory(p);
    } catch (_e) {
        return false;
    }
}

// Walk `dir`. When `depth > 0`, descend into immediate child directories
// once (so depth=1 gives the folder root + one nest deep, no further).
// Bounded recursion keeps the Explore list usable while letting the user
// drop a parent folder and still find the import.json one level in.
function walkDir(dir: any, root: any, out: Result[], depth: number = 1): void {
    const Files = Java.type("java.nio.file.Files");
    let stream: any;
    try {
        stream = Files.newDirectoryStream(dir);
    } catch (_e) {
        return;
    }
    try {
        const it = stream.iterator();
        while (true) {
            let entry: any;
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
    const Paths = Java.type("java.nio.file.Paths");
    const Files = Java.type("java.nio.file.Files");
    const out: Result[] = [];
    let p: any;
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
    if (cached !== undefined && now - cached.at < ENUMERATION_TTL_MS) {
        return cached.results;
    }
    const results = enumerateForSourceUncached(s);
    enumerationCache.set(s.fullPath, { at: now, results });
    return results;
}