/// <reference types="../../../CTAutocomplete" />

import { SourceMap, parseImportablesResult } from "htsw";

import { FileSystemFileLoader } from "../../utils/files";
import { buildKnowledgeStatusRows } from "../../knowledge/status";
import {
    getHousingUuid,
    getImportJsonPath,
    getParsedResult,
    setImportJsonPath,
    setKnowledgeRows,
    setParseError,
    setParsedResult,
} from "./index";
import { addRecent, getRecents } from "./recents";
import {
    hasSubList,
    importableSourcePath,
    importableSubListPath,
    type SubListKind,
} from "./importablePaths";

const SUB_LIST_KINDS: SubListKind[] = [
    "onEnterActions",
    "onExitActions",
    "leftClickActions",
    "rightClickActions",
];

let lastReparseAtMs = 0;
let lastMtimeCheckAt = 0;
let pendingReparse = false;
let lastSeenPath = "";
// Mtime snapshot per watched file (the import.json + every htsl source it
// referenced on the last successful parse). When any of these change on
// disk we reparse so knowledge dots / right-pane / live importer reflect
// the edit immediately.
const watchedMtimes: { [path: string]: number } = {};
const DEBOUNCE_MS = 300;
const MTIME_CHECK_INTERVAL_MS = 500;
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
 * Run on overlay init. Restore the user's last-loaded import.json from
 * the recents file (persisted across module reloads); only fall back to
 * walking `./htsw/imports/` if nothing in recents still exists.
 */
export function autoDiscoverImportJson(): void {
    const recents = getRecents();
    for (let i = 0; i < recents.length; i++) {
        if (fileExistsSafe(recents[i])) {
            setImportJsonPath(recents[i]);
            return;
        }
    }
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

function watch(path: string | undefined): void {
    if (path === undefined) return;
    if (watchedMtimes[path] !== undefined) return;
    watchedMtimes[path] = getMtimeMs(path);
}

function refreshWatchedMtimes(): void {
    for (const k in watchedMtimes) delete watchedMtimes[k];
    watch(getImportJsonPath());
    const parsed = getParsedResult();
    if (parsed === null) return;
    for (let i = 0; i < parsed.value.length; i++) {
        const imp = parsed.value[i];
        // Watch the parser-recorded source file (htsl for FUNCTION/EVENT,
        // import.json for everything else), the GUI's "smart" source path
        // (.snbt for ITEM via the parsed nbt span), AND any nested
        // action-list sources (REGION enter/exit + ITEM left/right-click
        // htsl files). Editing any of these flips knowledge dots and
        // re-renders sub-row previews.
        watch(parsed.gcx.sourceFiles.get(imp));
        watch(importableSourcePath(imp));
        for (let j = 0; j < SUB_LIST_KINDS.length; j++) {
            const kind = SUB_LIST_KINDS[j];
            if (!hasSubList(imp, kind)) continue;
            watch(importableSubListPath(imp, kind));
        }
    }
}

export function reparseImportJson(): void {
    pendingReparse = false;
    const path = getImportJsonPath();
    lastSeenPath = path;
    if (!fileExistsSafe(path)) {
        setParsedResult(null);
        setParseError(null);
        setKnowledgeRows([]);
        refreshWatchedMtimes();
        return;
    }
    const sm = new SourceMap(new FileSystemFileLoader());
    try {
        const result = parseImportablesResult(sm, path);
        setParsedResult(result);
        setParseError(null);
        // Any successful parse adds the path to the recents dropdown — covers loads from the
        // file browser, the path input, the recents dropdown itself (re-bumps to top), and
        // auto-discover. Dedup is handled inside addRecent.
        addRecent(path);
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
    refreshWatchedMtimes();
}

/**
 * Tick hook: if a reparse was scheduled and the debounce has elapsed, run
 * it. Also catches manual edits to the file: if the path or mtime changed
 * since last parse, reparse without a debounce. Watches all htsl sources
 * referenced by the current parse, not just the import.json — so editing
 * an htsl in VS Code immediately flips the knowledge dot.
 */
export function tickReparse(): void {
    if (pendingReparse) {
        // Wait the debounce out — don't disturb the timer. The earlier code
        // re-called scheduleReparse() here when the path differed from
        // lastSeenPath, which reset lastReparseAtMs every tick (~50ms) and
        // prevented the 300ms debounce from ever elapsing.
        if (Date.now() - lastReparseAtMs >= DEBOUNCE_MS) reparseImportJson();
        return;
    }
    const path = getImportJsonPath();
    if (path !== lastSeenPath) {
        scheduleReparse();
        return;
    }
    if (Date.now() - lastMtimeCheckAt < MTIME_CHECK_INTERVAL_MS) return;
    lastMtimeCheckAt = Date.now();
    for (const watched in watchedMtimes) {
        const m = getMtimeMs(watched);
        if (m !== 0 && m !== watchedMtimes[watched]) {
            reparseImportJson();
            return;
        }
    }
}
