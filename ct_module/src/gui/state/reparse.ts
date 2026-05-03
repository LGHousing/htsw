/// <reference types="../../../CTAutocomplete" />

import { SourceMap, parseImportablesResult } from "htsw";

import { FileSystemFileLoader } from "../../utils/files";
import { buildKnowledgeStatusRows } from "../../knowledge/status";
import {
    getHousingUuid,
    getImportJsonPath,
    setImportJsonPath,
    setKnowledgeRows,
    setParseError,
    setParsedResult,
} from "./index";

let lastReparseAtMs = 0;
let pendingReparse = false;
let lastSeenPath = "";
let lastSeenMtime = 0;
const DEBOUNCE_MS = 300;
const IMPORTS_ROOT = "./htsw/imports";


/**
 * Walk `./htsw/imports/**` for the first `import.json` we can find. Used
 * on init when the configured path doesn't exist yet — saves the user
 * having to type a path before anything appears.
 */
export function findFirstImportJson(): string | null {
    try {
        // @ts-ignore
        const Files = Java.type("java.nio.file.Files");
        // @ts-ignore
        const Paths = Java.type("java.nio.file.Paths");
        const root = Paths.get(String(IMPORTS_ROOT));
        if (!Files.exists(root)) return null;
        return walkForImportJson(root);
    } catch (_e) {
        return null;
    }
}

function walkForImportJson(dir: any): string | null {
    // @ts-ignore
    const Files = Java.type("java.nio.file.Files");
    let stream: any;
    try {
        stream = Files.newDirectoryStream(dir);
    } catch (_e) {
        return null;
    }
    try {
        const it = stream.iterator();
        const subdirs: any[] = [];
        while (it.hasNext()) {
            let p: any;
            try {
                p = it.next();
            } catch (_e) {
                break;
            }
            try {
                if (Files.isDirectory(p)) {
                    subdirs.push(p);
                } else if (Files.isRegularFile(p)) {
                    const name = String(p.getFileName().toString()).toLowerCase();
                    if (name === "import.json") {
                        return String(p.toString()).replace(/\\/g, "/");
                    }
                }
            } catch (_e) {
                // skip
            }
        }
        for (let i = 0; i < subdirs.length; i++) {
            const found = walkForImportJson(subdirs[i]);
            if (found !== null) return found;
        }
    } finally {
        try {
            stream.close();
        } catch (_e) {
            // ignore
        }
    }
    return null;
}

function fileExistsSafe(path: string): boolean {
    try {
        // @ts-ignore
        const Files = Java.type("java.nio.file.Files");
        // @ts-ignore
        const Paths = Java.type("java.nio.file.Paths");
        return Files.exists(Paths.get(String(path)));
    } catch (_e) {
        return false;
    }
}

/**
 * Run on overlay init. If the configured import.json path doesn't exist on
 * disk, try to find one under `./htsw/imports/` and set that as the path
 * before the first parse.
 */
export function autoDiscoverImportJson(): void {
    if (fileExistsSafe(getImportJsonPath())) return;
    const found = findFirstImportJson();
    if (found !== null) {
        setImportJsonPath(found);
    }
}

function getMtimeMs(path: string): number {
    try {
        // @ts-ignore
        const Paths = Java.type("java.nio.file.Paths");
        // @ts-ignore
        const Files = Java.type("java.nio.file.Files");
        return Number(Files.getLastModifiedTime(Paths.get(String(path))).toMillis());
    } catch (_e) {
        return 0;
    }
}

export function scheduleReparse(): void {
    pendingReparse = true;
    lastReparseAtMs = Date.now();
}

export function reparseImportJson(): void {
    pendingReparse = false;
    const path = getImportJsonPath();
    lastSeenPath = path;
    lastSeenMtime = getMtimeMs(path);
    if (!fileExistsSafe(path)) {
        setParsedResult(null);
        setParseError(null);
        setKnowledgeRows([]);
        return;
    }
    const sm = new SourceMap(new FileSystemFileLoader());
    try {
        const result = parseImportablesResult(sm, path);
        setParsedResult(result);
        setParseError(null);
        const housingUuid = getHousingUuid();
        if (housingUuid !== null) {
            setKnowledgeRows(buildKnowledgeStatusRows(housingUuid, result.value));
        } else {
            setKnowledgeRows([]);
        }
    } catch (err) {
        const msg = err && (err as any).message ? (err as any).message : String(err);
        setParsedResult(null);
        setParseError(msg);
        setKnowledgeRows([]);
    }
}

/**
 * Tick hook: if a reparse was scheduled and the debounce has elapsed, run
 * it. Also catches manual edits to the file: if the path or mtime changed
 * since last parse, reparse without a debounce.
 */
export function tickReparse(): void {
    if (pendingReparse && Date.now() - lastReparseAtMs >= DEBOUNCE_MS) {
        reparseImportJson();
        return;
    }
    const path = getImportJsonPath();
    if (path !== lastSeenPath) {
        scheduleReparse();
        return;
    }
    // mtime watch: only check ~once a second to avoid hammering disk.
    if (Date.now() - lastReparseAtMs > 1000) {
        const m = getMtimeMs(path);
        if (m !== 0 && m !== lastSeenMtime) {
            reparseImportJson();
        }
    }
}
