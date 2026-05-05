/// <reference types="../../../../CTAutocomplete" />

import { FileSystemFileLoader } from "../../../utils/files";
import { ImportEntry, Result, ResultImport } from "./types";

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

const ConcurrentLinkedQueue = Java.type("java.util.concurrent.ConcurrentLinkedQueue");
const pendingPaths: any = new ConcurrentLinkedQueue();

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
    while (true) {
        const next = pendingPaths.poll();
        if (next === null) break;
        addSourceFromAbsolute(String(next));
    }
}

export function queueSourcePath(absolute: string): void {
    pendingPaths.add(String(absolute));
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

export function removeAllStandaloneFiles(): void {
    for (let i = sources.length - 1; i >= 0; i--) {
        if (sources[i].kind === "file") {
            enumerationCache.delete(sources[i].fullPath);
            sources.splice(i, 1);
        }
    }
}

function relativePath(root: any, p: any): string {
    const rel = root.relativize(p);
    return String(rel.toString()).replace(/\\/g, "/");
}

type ImportCacheEntry = {
    mtime: number;
    entries: ImportEntry[];
    parseError?: string;
};

const importCache = new Map<string, ImportCacheEntry>();
const fileLoader = new FileSystemFileLoader();

function asString(v: unknown): string | undefined {
    return typeof v === "string" ? v : undefined;
}

function extractEntries(json: any): ImportEntry[] {
    const out: ImportEntry[] = [];
    if (json === null || typeof json !== "object") return out;

    const fns = json.functions;
    if (Array.isArray(fns)) {
        for (let i = 0; i < fns.length; i++) {
            const f = fns[i];
            if (!f || typeof f !== "object") continue;
            const name = asString(f.name) ?? "";
            const actionsPath = asString(f.actions);
            out.push({ type: "FUNCTION", name, actionsPath });
        }
    }

    const evs = json.events;
    if (Array.isArray(evs)) {
        for (let i = 0; i < evs.length; i++) {
            const e = evs[i];
            if (!e || typeof e !== "object") continue;
            const ev = asString(e.event) ?? "";
            const actionsPath = asString(e.actions);
            out.push({ type: "EVENT", event: ev, actionsPath });
        }
    }

    const items = json.items;
    if (Array.isArray(items)) {
        for (let i = 0; i < items.length; i++) {
            const it = items[i];
            if (!it || typeof it !== "object") continue;
            const name = asString(it.name) ?? "";
            const nbtPath = asString(it.nbt);
            out.push({ type: "ITEM", name, nbtPath });
        }
    }

    const regions = json.regions;
    if (Array.isArray(regions)) {
        for (let i = 0; i < regions.length; i++) {
            const r = regions[i];
            if (!r || typeof r !== "object") continue;
            out.push({ type: "REGION", name: asString(r.name) ?? "" });
        }
    }

    const menus = json.menus;
    if (Array.isArray(menus)) {
        for (let i = 0; i < menus.length; i++) {
            const m = menus[i];
            if (!m || typeof m !== "object") continue;
            out.push({ type: "MENU", name: asString(m.name) ?? "" });
        }
    }

    const npcs = json.npcs;
    if (Array.isArray(npcs)) {
        for (let i = 0; i < npcs.length; i++) {
            const n = npcs[i];
            if (!n || typeof n !== "object") continue;
            out.push({ type: "NPC", name: asString(n.name) ?? "" });
        }
    }

    return out;
}

function loadImportJson(fullPath: string, mtimeMs: number): ImportCacheEntry {
    const cached = importCache.get(fullPath);
    if (cached !== undefined && cached.mtime === mtimeMs) return cached;
    let entries: ImportEntry[] = [];
    let parseError: string | undefined;
    try {
        const src = fileLoader.readFile(fullPath);
        const json = JSON.parse(src);
        entries = extractEntries(json);
    } catch (e) {
        parseError = String(e);
    }
    const entry: ImportCacheEntry = { mtime: mtimeMs, entries, parseError };
    importCache.set(fullPath, entry);
    return entry;
}

function isRegularFileSafe(p: any): boolean {
    const Files = Java.type("java.nio.file.Files");
    try {
        return Files.isRegularFile(p);
    } catch (_e) {
        return false;
    }
}

function getMtimeSafe(p: any): number {
    const Files = Java.type("java.nio.file.Files");
    try {
        return Number(Files.getLastModifiedTime(p).toMillis());
    } catch (_e) {
        return 0;
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
    if (fname === "import.json") {
        const mtime = getMtimeSafe(p);
        const entry = loadImportJson(fullPath, mtime);
        const r: ResultImport = {
            type: "import",
            path,
            fullPath,
            entries: entry.entries,
            parseError: entry.parseError,
        };
        out.push(r);
    } else if (fname.length >= 5 && fname.lastIndexOf(".htsl") === fname.length - 5) {
        out.push({ type: "script", path, fullPath });
    } else if (fname.length >= 5 && fname.lastIndexOf(".snbt") === fname.length - 5) {
        out.push({ type: "item", path, fullPath });
    }
}

function walkDir(dir: any, root: any, out: Result[]): void {
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
                // Iterator state may be poisoned; bail out of this directory.
                break;
            }
            // Top-level only — recursive walking pulled too many irrelevant files into the
            // Explore list. The user can drill into subfolders explicitly via the Open
            // popover if they need them.
            if (isRegularFileSafe(entry)) {
                try {
                    visitFile(entry, root, out);
                } catch (_e) {
                    /* skip */
                }
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

export function invalidateEnumerationCache(fullPath?: string): void {
    if (fullPath === undefined) enumerationCache.clear();
    else enumerationCache.delete(fullPath);
}
